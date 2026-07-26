import { NextResponse } from 'next/server';
import { createRateLimiter } from '../../rateLimit';
import { classifyLxRoute } from '../routeClassification';

const LX_API_BASE = process.env.LX_API_BASE;
const LX_RESOLVER_BASE = process.env.LX_RESOLVER_BASE;
const LX_SEARCH_BASE = process.env.LX_SEARCH_BASE || 'https://api.vkeys.cn/v2/music/netease';
const LX_APPROVED_MEDIA_HOSTS = new Set(
  (process.env.LX_APPROVED_MEDIA_HOSTS || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean),
);

function configuredBase(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function approvedMediaUrl(value: string, baseHosts: Set<string>): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    const approved = baseHosts.has(host) || LX_APPROVED_MEDIA_HOSTS.has(host);
    return approved ? url : null;
  } catch {
    return null;
  }
}
const LX_API_KEY = 'share-v3';
const DEFAULT_LEVEL = process.env.LX_DEFAULT_LEVEL || '320';
const REQUEST_TIMEOUT_MS = 20_000;
const STREAM_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
] as const;
const CATALOG_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';
const rateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 200, maxEntries: 4_000 });

function setCdnCacheHeaders(headers: Headers, value: string): void {
  headers.set('Cache-Control', value);
  headers.set('Vercel-CDN-Cache-Control', value);
  headers.set('CDN-Cache-Control', value);
}

export function mediaContentType(value: string | null): string | null {
  if (!value) return null;
  const mediaType = value.split(';', 1)[0].trim().toLowerCase();
  return mediaType || null;
}

function closeUpstream(response: Response, cleanup: () => void): void {
  cleanup();
  void response.body?.cancel().catch(() => undefined);
}

function validContentRange(value: string | null): boolean {
  if (!value) return false;
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(value.trim());
  if (!match) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === '*' ? 0 : Number(match[3]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start && (total === 0 || end < total);
}

function catalogResponse(data: unknown): NextResponse {
  const response = NextResponse.json(data);
  setCdnCacheHeaders(response.headers, CATALOG_CACHE_CONTROL);
  return response;
}

function requestSignal(request: Request): AbortSignal {
  return AbortSignal.any([
    request.signal,
    AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  ]);
}

function lxHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Request-Key': LX_API_KEY,
  };
  headers['User-Agent'] = headers['User-Agent'] || 'lx-music-api/1.0';
  return headers;
}

async function upstreamFetch(request: Request, url: string, init: RequestInit = {}): Promise<Response> {
  const mergedHeaders: Record<string, string> = {
    ...init.headers as Record<string, string>,
    ...lxHeaders(),
  };
  return fetch(url, { ...init, headers: mergedHeaders, signal: requestSignal(request) });
}

interface StreamFetchResult {
  response: Response;
  controller: AbortController;
  cleanup: () => void;
}

async function streamFetch(request: Request, url: string, init: RequestInit = {}): Promise<StreamFetchResult> {
  const controller = new AbortController();
  const abortFromRequest = () => controller.abort(request.signal.reason);
  if (request.signal.aborted) abortFromRequest();
  else request.signal.addEventListener('abort', abortFromRequest, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), REQUEST_TIMEOUT_MS);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abortFromRequest);
  };
  try {
    // Timeout response headers only; do not cut off a long audio body.
    const response = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timeout);
    return { response, controller, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

function streamBody(
  response: Response,
  controller: AbortController,
  cleanup: () => void,
): ReadableStream<Uint8Array> | null {
  if (!response.body) {
    cleanup();
    return null;
  }
  const reader = response.body.getReader();
  let closed = false;
  const finish = (abort: boolean) => {
    if (closed) return;
    closed = true;
    cleanup();
    if (abort) controller.abort(new DOMException('Stream closed', 'AbortError'));
  };
  return new ReadableStream({
    async pull(streamController) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          finish(false);
          streamController.close();
        } else streamController.enqueue(chunk.value);
      } catch (error) {
        finish(true);
        streamController.error(error);
      }
    },
    async cancel(reason) {
      finish(true);
      await reader.cancel(reason);
    },
  });
}

function providerFailure(error: unknown, message: string): NextResponse {
  const status = error instanceof DOMException && error.name === 'TimeoutError' ? 504 : 502;
  return NextResponse.json({ error: message }, { status });
}

interface LxSearchResponse {
  code?: number;
  data?: unknown;
}

interface LxUrlResponse {
  url?: string;
  data?: Array<{ url?: string; expireTime?: number }>;
  extra?: { expire?: { time?: number } };
}

async function proxyStream(
  request: Request,
  streamUrl: string,
  init: RequestInit = {},
  expireTime?: number,
  additionalApprovedHosts: string[] = [],
): Promise<NextResponse> {
  const requestHeaders = new Headers();
  const range = request.headers.get('range');
  const ifRange = request.headers.get('if-range');
  if (range) requestHeaders.set('range', range);
  if (ifRange) requestHeaders.set('if-range', ifRange);
  requestHeaders.set('User-Agent', 'lx-music-api/1.0');
  requestHeaders.set('X-Request-Key', LX_API_KEY);

  try {
    let finalResponse: Response | null = null;
    let cleanupStream: (() => void) | undefined;
    let upstreamController: AbortController | undefined;
    let currentUrl = streamUrl;
    const baseHosts = new Set(
      [configuredBase(LX_API_BASE), configuredBase(LX_RESOLVER_BASE)]
        .filter((base): base is string => Boolean(base))
        .map((base) => new URL(base).hostname.toLowerCase()),
    );
    for (const host of additionalApprovedHosts) baseHosts.add(host.toLowerCase());
    const initialUrl = approvedMediaUrl(currentUrl, baseHosts);
    if (!initialUrl) return new NextResponse('Stream unavailable', { status: 502 });
    currentUrl = initialUrl.toString();
    const visited = new Set<string>();
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      if (visited.has(currentUrl)) return new NextResponse('Stream redirect loop', { status: 502 });
      visited.add(currentUrl);
      const fetched = await streamFetch(request, currentUrl, {
        ...init,
        headers: requestHeaders,
        redirect: 'manual',
      });
      const response = fetched.response;
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        closeUpstream(response, fetched.cleanup);
        const location = response.headers.get('location');
        if (!location) return new NextResponse('Stream unavailable', { status: 502 });
        try {
          const resolved = new URL(location, currentUrl);
          const approved = approvedMediaUrl(resolved.toString(), baseHosts);
          if (!approved) return new NextResponse('Stream unavailable', { status: 502 });
          currentUrl = approved.toString();
        } catch {
          return new NextResponse('Stream unavailable', { status: 502 });
        }
        continue;
      }
      finalResponse = response;
      cleanupStream = fetched.cleanup;
      upstreamController = fetched.controller;
      break;
    }
    if (!finalResponse) return new NextResponse('Too many stream redirects', { status: 502 });

    const isSuccessfulMedia = finalResponse.status >= 200 && finalResponse.status < 300;
    const contentType = mediaContentType(finalResponse.headers.get('content-type'));
    if (isSuccessfulMedia && (!contentType || (contentType !== 'application/octet-stream' && !contentType.startsWith('audio/')))) {
      closeUpstream(finalResponse, cleanupStream!);
      return NextResponse.json({ error: 'Upstream returned invalid media' }, { status: 502 });
    }
    if (finalResponse.status === 206 && !validContentRange(finalResponse.headers.get('content-range'))) {
      closeUpstream(finalResponse, cleanupStream!);
      return NextResponse.json({ error: 'Upstream returned an invalid range response' }, { status: 502 });
    }

    const headers = new Headers();
    for (const name of STREAM_RESPONSE_HEADERS) {
      const value = finalResponse.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    if (contentType) headers.set('Content-Type', contentType);
    else headers.delete('Content-Type');

    if (expireTime && Number.isFinite(expireTime)) {
      headers.set('X-LX-Expire-Time', String(expireTime));
    }

    if (range || finalResponse.status === 206) {
      headers.set('Cache-Control', 'private, no-store');
    } else if (finalResponse.ok) {
      // Resolver URLs are signed/temporary; never retain a proxy response for
      // a day when its origin may expire sooner.
      const now = Date.now();
      const expiryMs = expireTime && expireTime < 10_000_000_000 ? expireTime * 1000 : expireTime;
      const remainingSeconds = expiryMs && expiryMs > now
        ? Math.floor((expiryMs - now) / 1000) - 30
        : 0;
      if (remainingSeconds > 60) {
        const maxAge = Math.min(remainingSeconds, 900);
        setCdnCacheHeaders(headers, `public, s-maxage=${maxAge}, stale-while-revalidate=${Math.min(maxAge, 300)}`);
      } else {
        headers.set('Cache-Control', 'private, no-store');
      }
    }
    headers.set('Vary', 'Range');

    const body = streamBody(finalResponse, upstreamController!, cleanupStream!);
    return new NextResponse(body, {
      status: finalResponse.status,
      statusText: finalResponse.statusText,
      headers,
    });
  } catch (error) {
    return providerFailure(error, 'Stream fetch failed');
  }
}

const RESOLVE_QUALITY: Record<string, string> = {
  '128': '128k', '192': '192k', '320': '320k', 'hires': 'hires', 'lossless': 'hires',
};

function resolveQuality(level: string): string {
  return RESOLVE_QUALITY[level] || (Number.isInteger(Number(level)) ? (Number(level) >= 320 ? '320k' : '128k') : '320k');
}

async function handleSearch(req: Request): Promise<NextResponse> {
  const searchParams = new URL(req.url).searchParams;
  const key = searchParams.get('key');
  if (!key) {
    return NextResponse.json({ error: 'Missing search key' }, { status: 400 });
  }
  if (key.length > 200) {
    return NextResponse.json({ error: 'Search key too long' }, { status: 400 });
  }
  const type = searchParams.get('type') || '1';
  if (!['1', '2', '3', '4', '5'].includes(type)) {
    return NextResponse.json({ error: 'Invalid search type. Use 1=song,2=album,3=artist,4=lyric,5=playlist' }, { status: 400 });
  }

  try {
  const apiBase = configuredBase(LX_API_BASE);
  if (!apiBase) throw new Error('LX search endpoint is not configured');
  const upstream = new URL(`${apiBase}/search/${type}/${encodeURIComponent(key)}/1`);
    const response = await upstreamFetch(req, upstream.toString());
    if (response.ok && response.status !== 530) {
      const data = await response.json() as LxSearchResponse;
      return catalogResponse(data);
    }

    const fallback = new URL(LX_SEARCH_BASE);
    fallback.searchParams.set('word', key);
    const fallbackResponse = await fetch(fallback.toString(), { signal: requestSignal(req), headers: lxHeaders() });
    if (!fallbackResponse.ok) {
      return NextResponse.json({ error: `LX Music upstream error (status ${response.status})` }, { status: response.status });
    }
    const fallbackData = await fallbackResponse.json() as { code?: number; data?: Array<{ id?: number | string; song?: string; singer?: string; album?: string; cover?: string }> };
    const result = Array.isArray(fallbackData.data) ? fallbackData.data.map((item) => ({
      id: item.id,
      name: item.song,
      ar: item.singer ? item.singer.split('/').map((name) => ({ name })) : [],
      al: { name: item.album, picUrl: item.cover, id: item.id },
      platform: 'wy',
      type: 1,
    })) : [];
    return catalogResponse({ code: fallbackData.code === 200 ? 0 : fallbackData.code, data: { result } });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return providerFailure(error, 'LX Music search failed');
    }
    try {
      const fallback = new URL(LX_SEARCH_BASE);
      fallback.searchParams.set('word', key);
      const fallbackResponse = await fetch(fallback.toString(), { signal: requestSignal(req), headers: lxHeaders() });
      if (!fallbackResponse.ok) return providerFailure(error, 'LX Music search failed');
      const fallbackData = await fallbackResponse.json() as { code?: number; data?: Array<{ id?: number | string; song?: string; singer?: string; album?: string; cover?: string }> };
      const result = Array.isArray(fallbackData.data) ? fallbackData.data.map((item) => ({
        id: item.id,
        name: item.song,
        ar: item.singer ? item.singer.split('/').map((name) => ({ name })) : [],
        al: { name: item.album, picUrl: item.cover, id: item.id },
        platform: 'wy',
        type: 1,
      })) : [];
      return catalogResponse({ code: fallbackData.code === 200 ? 0 : fallbackData.code, data: { result } });
    } catch (fallbackError) {
      return providerFailure(fallbackError, 'LX Music search failed');
    }
  }
}

async function handleUrl(req: Request): Promise<NextResponse> {
  const searchParams = new URL(req.url).searchParams;
  const lxSongId = searchParams.get('id');
  const level = searchParams.get('level') || DEFAULT_LEVEL;
  const platform = searchParams.get('platform');
  const rawId = searchParams.get('rawId');
  const type = searchParams.get('type');

  if (!lxSongId) {
    return NextResponse.json({ error: 'Missing LX song id' }, { status: 400 });
  }
  if (!platform) {
    return NextResponse.json({ error: 'Missing platform parameter' }, { status: 400 });
  }

  const resolvedLevel = resolveQuality(level);

  let streamUrl: string | null = null;
  let expireTime: number | undefined;

  if (rawId && type) {
    const resolverBase = configuredBase(LX_RESOLVER_BASE) || configuredBase(LX_API_BASE);
    if (!resolverBase) return NextResponse.json({ error: 'LX resolver is not configured' }, { status: 503 });
    const safePlatform = /^[a-z]{2,8}$/i.test(platform) ? platform : null;
    const safeRawId = rawId && /^[A-Za-z0-9_-]{1,100}$/.test(rawId) ? rawId : null;
    if (!safePlatform || !safeRawId) return NextResponse.json({ error: 'Invalid LX stream identity' }, { status: 400 });
    const directUrl = `${resolverBase}/url/${safePlatform}/${encodeURIComponent(safeRawId)}/${resolvedLevel}`;
    try {
      const response = await upstreamFetch(req, directUrl);
      if (response.ok) {
        const data = await response.json() as LxUrlResponse;
        const resolvedUrl = data.url || data.data?.[0]?.url;
        if (resolvedUrl) {
          const candidate = approvedMediaUrl(resolvedUrl, new Set([
            ...[configuredBase(LX_API_BASE), configuredBase(LX_RESOLVER_BASE)]
              .filter((base): base is string => Boolean(base))
              .map((base) => new URL(base).hostname.toLowerCase()),
          ]));
          if (candidate) streamUrl = candidate.toString();
          expireTime = data.extra?.expire?.time ?? data.data?.[0]?.expireTime;
        }
      }
    } catch {
      // fall through to proxy mode
    }
  }

  if (!streamUrl) {
    const proxyBase = configuredBase(LX_API_BASE) || configuredBase(LX_RESOLVER_BASE);
    if (!proxyBase) return NextResponse.json({ error: 'LX resolver is not configured' }, { status: 503 });
    streamUrl = `${proxyBase}/url/${encodeURIComponent(platform)}/${encodeURIComponent(rawId ?? lxSongId)}/${resolvedLevel}`;
  }

  return proxyStream(req, streamUrl, {}, expireTime);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  if (process.env.NEXT_PUBLIC_LX_ENABLED !== 'true') {
    return NextResponse.json(
      { error: 'LX Music is disabled', provider: 'LX Music', unavailable: true },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const pathSegments = (await params).path || [];
  const [resource] = pathSegments;
  const hasApi = Boolean(configuredBase(LX_API_BASE));
  const hasResolver = Boolean(configuredBase(LX_RESOLVER_BASE));
  if (!hasApi && !hasResolver) {
    return NextResponse.json({ error: 'LX Music API not configured' }, { status: 503 });
  }

  const { bucket } = classifyLxRoute('lxmusic', resource);
  const limited = rateLimit(req, bucket);
  if (limited) return limited;

  if (resource === 'search') {
    return handleSearch(req);
  }
  if (resource === 'url') {
    return handleUrl(req);
  }

  return NextResponse.json({ error: `Unknown lxmusic endpoint: ${resource ?? ''}` }, { status: 400 });
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 });
}
