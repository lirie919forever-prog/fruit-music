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

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const REQUEST_TIMEOUT_MS = 15_000;
const CATALOG_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';
const FULL_TRACK_EXPECTATION_THRESHOLD_SECONDS = 45;

const rateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 120, maxEntries: 4_000 });

// Public Invidious instances - tried in order with automatic fallback.
const INVIDIOUS_INSTANCES = [
  'https://invidious.fdn.fr',
  'https://yewtu.be',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
];

interface InvidiousSearchItem {
  videoId?: string;
  title?: string;
  author?: string;
  lengthSeconds?: number;
  videoThumbnails?: Array<{ url?: string }>;
}

interface InvidiousVideoItem {
  videoId?: string;
  title?: string;
  author?: string;
  lengthSeconds?: number;
  adaptiveFormats?: Array<{
    url?: string;
    mimeType?: string;
    type?: string;
    bitrate?: number;
    container?: string;
  }>;
}

async function fetchFromInstance(
  instance: string,
  path: string,
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<Response> {
  const url = new URL(path, instance);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return fetch(url, {
    signal,
    headers: { 'Accept': 'application/json', 'User-Agent': 'Marea/1.0' },
  });
}

async function fetchFromInstances(
  path: string,
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<Response | null> {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const response = await fetchFromInstance(instance, path, params, signal);
      if (response.ok) return response;
    } catch {
      // Try next instance
      if (signal.aborted) return null;
    }
  }
  return null;
}

export async function GET(request: Request): Promise<NextResponse> {
  const { pathname } = new URL(request.url);
  const segments = pathname.split('/').filter(Boolean);
  // segments: ['api', 'music', 'invidious', ...path]
  const pathSegments = segments.slice(3);

  if (pathSegments.length === 0) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  const limited = rateLimit(request, 'invidious');
  if (limited) return limited;

  const signal = requestSignal(request, REQUEST_TIMEOUT_MS);

  // Search endpoint: /api/music/invidious/tracks?q=QUERY&limit=N
  if (pathSegments[0] === 'tracks') {
    const searchParams = new URL(request.url).searchParams;
    const query = searchParams.get('q')?.trim();
    if (!query || query.length > 200) {
      return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
    }
    const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? '40'), 1), 50);

    const response = await fetchFromInstances('/api/v1/search', {
      q: query,
      type: 'videos',
      sort_by: 'relevance',
    }, signal);

    if (!response) {
      return NextResponse.json({ error: 'Invidious search unavailable', results: [] }, { status: 502 });
    }

    try {
      const data: InvidiousSearchItem[] = await response.json();
      const results = (Array.isArray(data) ? data : [])
        .filter((item) => item.videoId && item.title && item.lengthSeconds && item.lengthSeconds >= 45)
        .slice(0, limit)
        .map((item) => ({
          videoId: item.videoId,
          title: item.title,
          author: item.author,
          lengthSeconds: item.lengthSeconds,
          videoThumbnails: item.videoThumbnails,
        }));

      const nextResp = NextResponse.json({ results });
      setCdnCacheHeaders(nextResp.headers, CATALOG_CACHE_CONTROL);
      return nextResp;
    } catch {
      return NextResponse.json({ error: 'Invalid response from Invidious', results: [] }, { status: 502 });
    }
  }

  // Stream endpoint: /api/music/invidious/stream/VIDEO_ID
  if (pathSegments[0] === 'stream' && pathSegments[1]) {
    const videoId = pathSegments[1];
    if (!VIDEO_ID_PATTERN.test(videoId)) {
      return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });
    }

    // Probe-only request: check if a stream is available without proxying the body.
    if (new URL(request.url).searchParams.get('probe') === '1') {
      const expected = Number(new URL(request.url).searchParams.get('expected') ?? '0');
      const videoResponse = await fetchFromInstances(`/api/v1/videos/${videoId}`, {}, signal);

      if (!videoResponse) {
        return NextResponse.json({ available: false }, { status: 200 });
      }

      try {
        const video: InvidiousVideoItem = await videoResponse.json();
        const duration = typeof video.lengthSeconds === 'number' ? video.lengthSeconds : 0;
        const hasAudio = (video.adaptiveFormats ?? []).some(
          (fmt) => (fmt.type?.includes('audio') || fmt.mimeType?.includes('audio')) && fmt.url,
        );

        const durationOk = expected > 0
          ? Math.abs(duration - expected) <= Math.max(15, expected * 0.25)
          : duration >= FULL_TRACK_EXPECTATION_THRESHOLD_SECONDS;

        return NextResponse.json({ available: hasAudio && durationOk });
      } catch {
        return NextResponse.json({ available: false });
      }
    }

    // Actual stream: fetch from Invidious and proxy.
    const videoResponse = await fetchFromInstances(`/api/v1/videos/${videoId}`, {}, signal);
    if (!videoResponse) {
      return NextResponse.json({ error: 'Invidious stream unavailable' }, { status: 502 });
    }

    try {
      const video: InvidiousVideoItem = await videoResponse.json();
      const audioFormat = (video.adaptiveFormats ?? []).find(
        (fmt) => (fmt.type?.includes('audio') || fmt.mimeType?.includes('audio')) && fmt.url,
      );

      if (!audioFormat?.url) {
        return NextResponse.json({ error: 'No audio stream available' }, { status: 502 });
      }

      const upstream = await fetch(audioFormat.url, {
        signal,
        headers: { Range: request.headers.get('Range') ?? '' },
      });

      if (!upstream.ok) {
        return NextResponse.json({ error: 'Stream fetch failed' }, { status: 502 });
      }

      const headers = new Headers();
      const contentType = mediaContentType(upstream.headers.get('Content-Type')) ?? 'audio/mp4';
      headers.set('Content-Type', contentType);
      const contentLength = upstream.headers.get('Content-Length');
      if (contentLength) headers.set('Content-Length', contentLength);
      const contentRange = upstream.headers.get('Content-Range');
      if (contentRange && validContentRange(contentRange)) headers.set('Content-Range', contentRange);
      headers.set('Accept-Ranges', 'bytes');

      const controller = new AbortController();
      const body = streamBody(upstream, controller, () => closeUpstream(upstream, () => controller.abort()));
      return new NextResponse(body ?? null, { status: upstream.status, headers });
    } catch {
      return NextResponse.json({ error: 'Failed to parse video info' }, { status: 502 });
    }
  }

  return NextResponse.json({ error: 'Unknown path' }, { status: 400 });
}
