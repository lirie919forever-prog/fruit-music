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

const rateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 120, maxEntries: 4_000 });

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

    // Use the public meting API proxy which reliably returns MP3 streams.
    // The Netease outer URL endpoint frequently returns 404 for popular songs
    // due to VIP restrictions; the meting proxy handles authentication internally.
    const streamUrl = `https://api.injahow.cn/meting/?type=url&id=${songId}`;

    // Probe: check if the meting API returns an audio stream
    if (new URL(request.url).searchParams.get('probe') === '1') {
      try {
        const probeResponse = await fetch(streamUrl, {
          signal,
          headers: { 'User-Agent': NETEASE_HEADERS['User-Agent'] },
        });
        const contentType = probeResponse.headers.get('Content-Type') ?? '';
        const available = contentType.includes('audio') || contentType.includes('mpeg');
        return NextResponse.json({ available });
      } catch {
        return NextResponse.json({ available: false });
      }
    }

    // Stream proxy via the meting API
    try {
      const upstream = await fetch(streamUrl, {
        signal,
        headers: {
          'User-Agent': NETEASE_HEADERS['User-Agent'],
          ...(request.headers.get('Range') ? { Range: request.headers.get('Range')! } : {}),
        },
      });

      const contentType = upstream.headers.get('Content-Type') ?? '';
      if (!contentType.includes('audio') && !contentType.includes('mpeg')) {
        return NextResponse.json({ error: 'Netease stream is unavailable for this song' }, { status: 502 });
      }

      const headers = new Headers();
      const ct = mediaContentType(contentType) ?? 'audio/mpeg';
      headers.set('Content-Type', ct);
      const cl = upstream.headers.get('Content-Length');
      if (cl) headers.set('Content-Length', cl);
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
