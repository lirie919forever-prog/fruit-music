import { NextResponse } from 'next/server';
import { createRateLimiter } from '../../rateLimit';
import {
  closeUpstream,
  mediaContentType,
  requestSignal,
  setCdnCacheHeaders,
  streamBody,
  validContentRange,
} from '../../streamProxy';

const SONG_ID_PATTERN = /^\d{1,20}$/;
const REQUEST_TIMEOUT_MS = 12_000;
const CATALOG_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';
const FULL_TRACK_EXPECTATION_THRESHOLD_SECONDS = 45;
const NETEASE_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://music.163.com',
  Accept: 'application/json',
};

const rateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 600, maxEntries: 8_000 });

function metingStreamUrl(songId: string): string {
  return `https://api.injahow.cn/meting/?type=url&id=${songId}`;
}

function neteaseOuterUrl(songId: string): string {
  return `https://music.163.com/song/media/outer/url?id=${songId}.mp3`;
}

/**
 * Meting returns application/octet-stream (with a large Content-Length) for
 * valid MP3 streams on Vercel's edge runtime, while VIP / unavailable songs
 * return tiny or non-audio payloads. Accept audio, mpeg, or a sizable
 * octet-stream body as a playable stream.
 */
function isAudioLike(contentType: string, contentLength: string | null): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes('audio') || ct.includes('mpeg')) return true;
  if (ct.includes('octet-stream') && contentLength && Number(contentLength) > 1024) return true;
  return false;
}

function upContentLength(resp: Response): string | null {
  return resp.headers.get('Content-Length') ?? resp.headers.get('content-length');
}

function totalResponseBytes(response: Response): number {
  const contentRange = response.headers.get('content-range');
  const total = contentRange?.match(/^bytes \d+-\d+\/(\d+)$/i)?.[1];
  if (total) return Number(total);
  const length = upContentLength(response);
  return length ? Number(length) : 0;
}

function expectedMinimumBytes(expectedDuration: number): number {
  // A 32 kbps full recording is already larger than this. The decoder remains
  // the final authority, but this rejects a known 20-30 second sample before
  // it ever reaches the player queue.
  return Math.ceil(expectedDuration * 4_000);
}

function isExpectedFullRecording(response: Response, expectedDuration: number): boolean {
  if (expectedDuration <= FULL_TRACK_EXPECTATION_THRESHOLD_SECONDS) return true;
  const totalBytes = totalResponseBytes(response);
  return totalBytes === 0 || totalBytes >= expectedMinimumBytes(expectedDuration);
}

function releaseResponse(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

async function fetchUsableStream(
  url: string,
  signal: AbortSignal,
  headers: HeadersInit,
  expectedDuration: number,
): Promise<Response | null> {
  const response = await fetch(url, { signal, headers });
  const contentType = response.headers.get('Content-Type') ?? '';
  if (
    !response.ok ||
    !isAudioLike(contentType, upContentLength(response)) ||
    !isExpectedFullRecording(response, expectedDuration)
  ) {
    releaseResponse(response);
    return null;
  }
  return response;
}

async function probeNeteaseStream(url: string, signal: AbortSignal, expectedDuration: number): Promise<boolean> {
  const response = await fetchUsableStream(
    url,
    signal,
    { 'User-Agent': NETEASE_HEADERS['User-Agent'], Range: 'bytes=0-1' },
    expectedDuration,
  );
  if (!response) return false;
  releaseResponse(response);
  return true;
}

interface NeteaseSearchSong {
  id: number;
  name: string;
  duration?: number;
  artists?: Array<{ name?: string; id?: number }>;
  album?: { name?: string; id?: number; picUrl?: string };
}

interface NeteaseSearchPayload {
  result?: { songs?: NeteaseSearchSong[] };
  code?: number;
}

export async function GET(request: Request): Promise<NextResponse> {
  const { pathname } = new URL(request.url);
  const segments = pathname.split('/').filter(Boolean);
  const pathSegments = segments.slice(3);

  if (pathSegments.length === 0) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  const limited = rateLimit(request, 'netease');
  if (limited) return limited;

  const signal = requestSignal(request, REQUEST_TIMEOUT_MS);

  // Search endpoint
  if (pathSegments[0] === 'tracks') {
    const searchParams = new URL(request.url).searchParams;
    const query = searchParams.get('q')?.trim();
    if (!query || query.length > 200) {
      return NextResponse.json({ error: 'Invalid query', result: { songs: [] } }, { status: 400 });
    }
    const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? '40'), 1), 50);

    try {
      const url = new URL('https://music.163.com/api/search/get');
      url.searchParams.set('s', query);
      url.searchParams.set('type', '1');
      url.searchParams.set('limit', String(limit));

      const response = await fetch(url, { signal, headers: NETEASE_HEADERS });
      if (!response.ok) {
        return NextResponse.json({ error: 'Netease search failed', result: { songs: [] } }, { status: 200 });
      }

      const data: NeteaseSearchPayload = await response.json();
      const songs = (data.result?.songs ?? []).filter((s) => s.id && s.name && (s.duration ?? 0) >= 30000);

      const resp = NextResponse.json({
        result: {
          songs: songs.map((s) => ({
            id: s.id,
            name: s.name,
            duration: s.duration,
            artists: s.artists,
            album: s.album,
          })),
        },
      });
      setCdnCacheHeaders(resp.headers, CATALOG_CACHE_CONTROL);
      return resp;
    } catch {
      return NextResponse.json({ error: 'Netease search unavailable', result: { songs: [] } }, { status: 200 });
    }
  }

  // Stream probe or proxy: /api/music/netease/stream/SONG_ID
  if (pathSegments[0] === 'stream' && pathSegments[1]) {
    const songId = pathSegments[1];
    if (!SONG_ID_PATTERN.test(songId)) {
      return NextResponse.json({ error: 'Invalid song ID' }, { status: 400 });
    }

    const rangeHeader = request.headers.get('Range') ?? undefined;
    const expectedDuration = Number(new URL(request.url).searchParams.get('expected'));
    const fullTrackExpected =
      Number.isFinite(expectedDuration) && expectedDuration > FULL_TRACK_EXPECTATION_THRESHOLD_SECONDS
        ? expectedDuration
        : 0;

    // Probe both approved sources with a tiny range. A media content type by
    // itself is not enough: some IDs return a 20-30 second trial clip with an
    // otherwise valid MP3 response.
    if (new URL(request.url).searchParams.get('probe') === '1') {
      try {
        const metingAvailable = await probeNeteaseStream(metingStreamUrl(songId), signal, fullTrackExpected);
        if (metingAvailable) return NextResponse.json({ available: true });
        const outerAvailable = await probeNeteaseStream(neteaseOuterUrl(songId), signal, fullTrackExpected);
        return NextResponse.json({ available: outerAvailable });
      } catch {
        return NextResponse.json({ available: false });
      }
    }

    // Stream proxy: try meting first, then fall back to the outer URL.
    try {
      const streamHeaders: Record<string, string> = {
        'User-Agent': NETEASE_HEADERS['User-Agent'],
      };
      if (rangeHeader) streamHeaders['Range'] = rangeHeader;

      let upstream = await fetchUsableStream(metingStreamUrl(songId), signal, streamHeaders, fullTrackExpected);
      if (!upstream) {
        upstream = await fetchUsableStream(neteaseOuterUrl(songId), signal, streamHeaders, fullTrackExpected);
      }
      if (!upstream) {
        return NextResponse.json({ error: 'Netease stream is unavailable for this song' }, { status: 502 });
      }

      const headers = new Headers();
      const contentType = upstream.headers.get('Content-Type') ?? '';
      const contentLength = upContentLength(upstream);
      const ct = mediaContentType(contentType) ?? 'audio/mpeg';
      headers.set('Content-Type', ct);
      if (contentLength) headers.set('Content-Length', contentLength);
      const cr = upstream.headers.get('Content-Range');
      if (cr && validContentRange(cr)) headers.set('Content-Range', cr);
      headers.set('Accept-Ranges', 'bytes');

      const controller = new AbortController();
      const body = streamBody(upstream, controller, () => closeUpstream(upstream, () => controller.abort()));
      return new NextResponse(body ?? null, { status: upstream.status, headers });
    } catch {
      return NextResponse.json({ error: 'Netease stream proxy failed' }, { status: 502 });
    }
  }

  return NextResponse.json({ error: 'Unknown path' }, { status: 400 });
}
