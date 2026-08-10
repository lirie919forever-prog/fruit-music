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
const NETEASE_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': 'https://music.163.com',
  'Accept': 'application/json',
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
      const songs = (data.result?.songs ?? []).filter(
        (s) => s.id && s.name && (s.duration ?? 0) >= 30000,
      );

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

    // Probe: check if any Netease source returns an audio stream.
    if (new URL(request.url).searchParams.get('probe') === '1') {
      try {
        const meting = await fetch(metingStreamUrl(songId), {
          signal,
          headers: { 'User-Agent': NETEASE_HEADERS['User-Agent'] },
        });
        if (isAudioLike(meting.headers.get('Content-Type') ?? '', upContentLength(meting))) {
          return NextResponse.json({ available: true });
        }
        // Fallback: Netease outer URL serves non-VIP tracks from server IPs.
        const outer = await fetch(neteaseOuterUrl(songId), {
          signal,
          headers: { 'User-Agent': NETEASE_HEADERS['User-Agent'] },
        });
        const outerAvailable =
          outer.ok && isAudioLike(outer.headers.get('Content-Type') ?? '', upContentLength(outer));
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

      let upstream = await fetch(metingStreamUrl(songId), { signal, headers: streamHeaders });
      let contentType = upstream.headers.get('Content-Type') ?? '';
      if (!isAudioLike(contentType, upContentLength(upstream))) {
        await upstream.body?.cancel().catch(() => {});
        upstream = await fetch(neteaseOuterUrl(songId), { signal, headers: streamHeaders });
        contentType = upstream.headers.get('Content-Type') ?? '';
      }

      const contentLength = upContentLength(upstream);
      if (!isAudioLike(contentType, contentLength)) {
        return NextResponse.json({ error: 'Netease stream is unavailable for this song' }, { status: 502 });
      }

      const headers = new Headers();
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