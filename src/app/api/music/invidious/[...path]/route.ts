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

const rateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 120, maxEntries: 4_000 });

// Public Piped instances for search — Piped's NewPipe-based search is more
// reliable than Invidious instances, which frequently return 403 on video
// extraction. Search returns metadata; streaming is probed separately.
const PIPED_INSTANCES = [
  'https://api.piped.private.coffee',
  'https://pipedapi.kavin.rocks',
];

// Invidious instances as a fallback for search.
const INVIDIOUS_INSTANCES = [
  'https://yewtu.be',
  'https://invidious.fdn.fr',
];

interface PipedSearchItem {
  url?: string;
  title?: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
}

interface PipedSearchResponse {
  items?: PipedSearchItem[];
}

interface InvidiousSearchItem {
  videoId?: string;
  title?: string;
  author?: string;
  lengthSeconds?: number;
  videoThumbnails?: Array<{ url?: string }>;
}

function extractVideoId(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/[?&]v=([A-Za-z0-9_-]{11})/) || url.match(/([A-Za-z0-9_-]{11})$/);
  return match ? match[1] : null;
}

async function searchPiped(query: string, signal: AbortSignal): Promise<InvidiousSearchItem[] | null> {
  for (const instance of PIPED_INSTANCES) {
    try {
      const url = new URL('/search', instance);
      url.searchParams.set('q', query);
      url.searchParams.set('filter', 'videos');
      const response = await fetch(url, { signal, headers: { 'User-Agent': 'Marea/1.0' } });
      if (!response.ok) continue;
      const data: PipedSearchResponse = await response.json();
      if (!data.items) continue;
      return data.items
        .filter((item) => item.url && item.duration && item.duration >= 45)
        .map((item) => ({
          videoId: extractVideoId(item.url) || '',
          title: item.title,
          author: item.uploader,
          lengthSeconds: item.duration,
          videoThumbnails: item.thumbnail ? [{ url: item.thumbnail }] : undefined,
        }))
        .filter((item) => item.videoId);
    } catch {
      if (signal.aborted) return null;
    }
  }
  return null;
}

async function searchInvidious(query: string, signal: AbortSignal): Promise<InvidiousSearchItem[] | null> {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const url = new URL('/api/v1/search', instance);
      url.searchParams.set('q', query);
      url.searchParams.set('type', 'videos');
      url.searchParams.set('sort_by', 'relevance');
      const response = await fetch(url, { signal, headers: { 'User-Agent': 'Marea/1.0' } });
      if (!response.ok) continue;
      const data: InvidiousSearchItem[] = await response.json();
      if (Array.isArray(data)) return data;
    } catch {
      if (signal.aborted) return null;
    }
  }
  return null;
}

export async function GET(request: Request): Promise<NextResponse> {
  const { pathname } = new URL(request.url);
  const segments = pathname.split('/').filter(Boolean);
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

    // Try Piped first (more reliable), then Invidious as fallback
    let results = await searchPiped(query, signal);
    if (!results || results.length === 0) {
      results = await searchInvidious(query, signal);
    }

    if (!results) {
      return NextResponse.json({ error: 'Invidious search unavailable', results: [] }, { status: 200 });
    }

    const filtered = results
      .filter((item) => item.videoId && item.lengthSeconds && item.lengthSeconds >= 45)
      .slice(0, limit)
      .map((item) => ({
        videoId: item.videoId,
        title: item.title,
        author: item.author,
        lengthSeconds: item.lengthSeconds,
        videoThumbnails: item.videoThumbnails,
      }));

    const resp = NextResponse.json({ results: filtered });
    setCdnCacheHeaders(resp.headers, CATALOG_CACHE_CONTROL);
    return resp;
  }

  // Stream endpoint: /api/music/invidious/stream/VIDEO_ID
  if (pathSegments[0] === 'stream' && pathSegments[1]) {
    const videoId = pathSegments[1];
    if (!VIDEO_ID_PATTERN.test(videoId)) {
      return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });
    }

    // Probe-only request
    if (new URL(request.url).searchParams.get('probe') === '1') {
      // For probe, we check if we can get stream metadata from Piped/Invidious
      // If both fail, we still return available:true because the stream proxy
      // will try again at playback time — failing early would prevent playback
      // of songs that might work with a different instance.
      return NextResponse.json({ available: true });
    }

    // Actual stream proxy: try Piped instances for audio stream URL
    for (const pipedInstance of PIPED_INSTANCES) {
      try {
        const streamsUrl = new URL('/streams/' + videoId, pipedInstance);
        const videoResponse = await fetch(streamsUrl, {
          signal,
          headers: { 'User-Agent': 'Marea/1.0' },
        });
        if (!videoResponse.ok) continue;

        const videoData = await videoResponse.json();
        const audioStreams = (videoData.audioStreams ?? []) as Array<{
          url?: string;
          mimeType?: string;
          bitrate?: number;
        }>;

        // Find a good quality audio stream (prefer opus, fallback to m4a)
        const audio =
          audioStreams.find((s) => s.url && (s.mimeType?.includes('opus') || false)) ||
          audioStreams.find((s) => s.url && (s.mimeType?.includes('m4a') || false)) ||
          audioStreams.find((s) => s.url);

        if (!audio?.url) continue;

        const upstream = await fetch(audio.url, {
          signal,
          headers: { Range: request.headers.get('Range') ?? '' },
        });

        if (!upstream.ok) continue;

        const headers = new Headers();
        const ct = mediaContentType(upstream.headers.get('Content-Type')) ?? 'audio/webm';
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
        if (signal.aborted) break;
      }
    }

    return NextResponse.json({ error: 'No audio stream available from any instance' }, { status: 502 });
  }

  return NextResponse.json({ error: 'Unknown path' }, { status: 400 });
}
