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

export const runtime = 'nodejs';

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const REQUEST_TIMEOUT_MS = 15_000;
const PIPED_ATTEMPT_TIMEOUT_MS = 5_000;
const CATALOG_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';

const rateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 240, maxEntries: 8_000 });

// Public Piped instances. Search has historically been more reliable through
// Piped than through the Invidious instances, which increasingly return HTML
// (anti-scraping) or disable their /api/v1/videos endpoint entirely. Streaming
// remains the weak link: Piped's /streams extract an audio URL fetched straight
// from googlevideo, which sometimes 403s or returns zero audioStreams when the
// instance falls behind YouTube's signature changes. We try them in order and
// keep the pool broad so a single instance outage does not take the path down.
const PIPED_INSTANCES = [
  'https://api.piped.private.coffee', // confirmed live (music_songs + /streams)
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.r4fo.com',
  'https://pipedapi.reallyaweso.me',
  'https://pipedapi.nosebs.ru',
];

// Invidious instances as a fallback for search only. The /api/v1/videos
// (stream metadata) endpoint has been disabled or returns HTML on every public
// instance we have probed, so it is not used for streaming; only /api/v1/search
// still resolves JSON here.
const INVIDIOUS_INSTANCES = ['https://yewtu.be', 'https://invidious.fdn.fr'];

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

interface PipedAudioStream {
  url?: string;
  mimeType?: string;
  bitrate?: number;
}

interface PipedStreamsResponse {
  audioStreams?: PipedAudioStream[];
}

/** Resolved audio URLs (googlevideo) are time-limited and IP-bound. Cache the
 * lookup for a short window so probe + play do not double-fetch /streams. */
const RESOLVED_AUDIO_TTL_MS = 2 * 60 * 1000;
const resolvedAudioCache = new Map<string, { url: string; mimeType: string; expires: number }>();

function pruneAudioCache(): void {
  const now = Date.now();
  for (const [key, entry] of resolvedAudioCache) {
    if (entry.expires <= now) resolvedAudioCache.delete(key);
  }
}

/** Per-attempt timeout that also respects the caller's abort signal. */
function attemptSignal(parentSignal: AbortSignal, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (parentSignal.aborted) controller.abort();
  else parentSignal.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => { clearTimeout(timer); parentSignal.removeEventListener('abort', onAbort); },
  };
}

function extractVideoId(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/[?&]v=([A-Za-z0-9_-]{11})/) || url.match(/([A-Za-z0-9_-]{11})$/);
  return match ? match[1] : null;
}

async function searchPiped(
  query: string,
  signal: AbortSignal,
  filter: 'videos' | 'music_songs' = 'videos',
): Promise<InvidiousSearchItem[] | null> {
  return Promise.any(
    PIPED_INSTANCES.map((instance) => pipedSearchOne(instance, query, signal, filter)),
  ).catch(() => null);
}

async function pipedSearchOne(
  instance: string,
  query: string,
  parentSignal: AbortSignal,
  filter: 'videos' | 'music_songs',
): Promise<InvidiousSearchItem[]> {
  const { signal, cleanup } = attemptSignal(parentSignal, PIPED_ATTEMPT_TIMEOUT_MS);
  try {
    const url = new URL('/search', instance);
    url.searchParams.set('q', query);
    url.searchParams.set('filter', filter);
    const response = await fetch(url, { signal, headers: { 'User-Agent': 'Marea/1.0' } });
    if (!response.ok) throw new Error(`${response.status}`);
    const data: PipedSearchResponse = await response.json();
    if (!data.items) throw new Error('no items');
    const results = data.items
      .filter((item) => item.url && item.duration && item.duration >= 45)
      .map((item) => ({
        videoId: extractVideoId(item.url) || '',
        title: item.title,
        author: item.uploader,
        lengthSeconds: item.duration,
        videoThumbnails: item.thumbnail ? [{ url: item.thumbnail }] : undefined,
      }))
      .filter((item) => item.videoId);
    if (results.length === 0) throw new Error('no matches');
    return results;
  } finally {
    cleanup();
  }
}

async function searchInvidious(query: string, signal: AbortSignal): Promise<InvidiousSearchItem[] | null> {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const url = new URL('/api/v1/search', instance);
      url.searchParams.set('q', query);
      url.searchParams.set('type', 'videos');
      url.searchParams.set('sort_by', 'relevance');
      const response = await fetch(url, { signal, headers: { 'User-Agent': 'Marea/1.0', Accept: 'application/json' } });
      if (!response.ok) continue;
      const text = await response.text();
      if (!text || text.startsWith('<')) continue;
      const data: InvidiousSearchItem[] = JSON.parse(text);
      if (Array.isArray(data)) return data;
    } catch {
      if (signal.aborted) return null;
    }
  }
  return null;
}

/**
 * Resolves a usable Piped audio stream URL for a video id. Races all
 * instances in parallel (Promise.any); the first to return a real audio URL
 * wins. Dead instances simply lose the race and abort quickly via the
 * per-attempt timeout. Previously this iterated sequentially, wasting up to
 * several timeouts on dead instances before reaching a live one.
 */
async function resolvePipedAudio(
  videoId: string,
  signal: AbortSignal,
): Promise<{ url: string; mimeType: string } | null> {
  const cached = resolvedAudioCache.get(videoId);
  if (cached && cached.expires > Date.now()) {
    return { url: cached.url, mimeType: cached.mimeType };
  }
  const result = await Promise.any(
    PIPED_INSTANCES.map((instance) => resolvePipedAudioOne(instance, videoId, signal)),
  ).catch(() => null);
  if (result) {
    pruneAudioCache();
    resolvedAudioCache.set(videoId, {
      url: result.url,
      mimeType: result.mimeType,
      expires: Date.now() + RESOLVED_AUDIO_TTL_MS,
    });
  }
  return result;
}

async function resolvePipedAudioOne(
  instance: string,
  videoId: string,
  parentSignal: AbortSignal,
): Promise<{ url: string; mimeType: string }> {
  const { signal, cleanup } = attemptSignal(parentSignal, PIPED_ATTEMPT_TIMEOUT_MS);
  try {
    const url = new URL(`/streams/${videoId}`, instance);
    const response = await fetch(url, { signal, headers: { 'User-Agent': 'Marea/1.0' } });
    if (!response.ok) throw new Error(`${response.status}`);
    const data: PipedStreamsResponse = await response.json();
    const audioStreams = Array.isArray(data?.audioStreams) ? data.audioStreams : [];
    const preferred =
      audioStreams.find((stream) => stream.url && /opus/i.test(stream.mimeType ?? '')) ||
      audioStreams.find((stream) => stream.url && /m4a|mp4/i.test(stream.mimeType ?? '')) ||
      audioStreams.find((stream) => typeof stream.url === 'string' && stream.url.length > 0);
    if (!preferred?.url) throw new Error('no audio');
    return { url: preferred.url, mimeType: mediaContentType(preferred.mimeType ?? null) ?? 'audio/webm' };
  } finally {
    cleanup();
  }
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

    // YouTube Music official full tracks first (filter=music_songs); these
    // stream at full length rather than 30s clips. Fall back to generic
    // video search, then Invidious.
    let results = await searchPiped(query, signal, 'music_songs');
    if (!results || results.length === 0) {
      results = await searchPiped(query, signal, 'videos');
    }
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

    const isProbe = new URL(request.url).searchParams.get('probe') === '1';
    const resolved = await resolvePipedAudio(videoId, signal);

    if (isProbe) {
      // Honest probe: a track is verified only when a real fetchable audio URL
      // exists. Previously this always returned available:true, which let the
      // resolver promote Invidious matches that 502'd at play time and left the
      // chart attesting to "full tracks" the user could not actually hear.
      return NextResponse.json(
        { available: Boolean(resolved?.url), provider: 'Invidious' },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    if (!resolved?.url) {
      return NextResponse.json(
        { error: 'No audio stream available from any instance' },
        { status: 502, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    try {
      const upstream = await fetch(resolved.url, {
        signal,
        headers: { Range: request.headers.get('Range') ?? '' },
      });
      if (!upstream.ok) {
        closeUpstream(upstream, () => undefined);
        return NextResponse.json(
          { error: `Upstream stream responded ${upstream.status}` },
          { status: 502, headers: { 'Cache-Control': 'private, no-store' } },
        );
      }

      const headers = new Headers();
      const contentType = mediaContentType(upstream.headers.get('Content-Type')) ?? resolved.mimeType;
      headers.set('Content-Type', contentType);
      const contentLength = upstream.headers.get('Content-Length');
      if (contentLength) headers.set('Content-Length', contentLength);
      const contentRange = upstream.headers.get('Content-Range');
      if (contentRange && validContentRange(contentRange)) headers.set('Content-Range', contentRange);
      headers.set('Accept-Ranges', 'bytes');
      headers.set('Vary', 'Range');
      // Probe-resolved URLs carry IP/time binding; never cache at the edge.
      headers.set('Cache-Control', 'private, no-store');

      const controller = new AbortController();
      const body = streamBody(upstream, controller, () => closeUpstream(upstream, () => controller.abort()));
      return new NextResponse(body ?? null, { status: upstream.status, headers });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invidious stream fetch failed' },
        { status: 502, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
  }

  return NextResponse.json({ error: 'Unknown path' }, { status: 400 });
}