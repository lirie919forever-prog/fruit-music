import { NextResponse } from 'next/server';
import { createRateLimiter } from '../../rateLimit';
import { classifyLxRoute } from '../routeClassification';
import {
  STREAM_RESPONSE_HEADERS,
  closeUpstream,
  fetchApprovedMedia,
  mediaContentType,
  providerFailure,
  requestSignal,
  setCdnCacheHeaders,
  streamBody,
  validContentRange,
} from '../../streamProxy';

const LX_API_BASE = process.env.LX_API_BASE;
const LX_RESOLVER_BASE = process.env.LX_RESOLVER_BASE;
const LX_SEARCH_BASE = process.env.LX_SEARCH_BASE || 'https://api.vkeys.cn/v2/music/netease';
const LX_APPROVED_MEDIA_HOSTS = new Set(
  (process.env.LX_APPROVED_MEDIA_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
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

/**
 * The configured resolver hosts plus whatever `LX_APPROVED_MEDIA_HOSTS` names.
 *
 * Read fresh on each call rather than captured at module load: the env is
 * stubbed per test, and a cached set would answer with whichever value happened
 * to be set when the module was first imported.
 *
 * NetEase hands back media URLs on `http://m70x.music.126.net/...` (audio) and
 * `http://pN.music.126.net/...` (artwork). Those nodes rotate, so enumerating
 * hosts is not possible — the registrable domain is the real boundary. They
 * serve identical bytes over https, so the rewrite here keeps every hop on a
 * checked scheme rather than widening the proxy accept plain http. The suffix
 * stays narrow: `.126.net` is NetEase's CDN, the id feeding the resolver is
 * already validated, and the resolver host itself is allowlisted above, so the
 * resolved URL is not attacker-controllable — this grants nothing the trusted
 * resolver could not already direct playback to.
 */
const NETEASE_MEDIA_SUFFIXES = ['music.126.net', '126.net'];

function isNetEaseMediaHost(url: URL): boolean {
  if (url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return NETEASE_MEDIA_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function isApprovedLxMedia(url: URL): boolean {
  if (url.username || url.password || url.port || url.hash) return false;
  if (url.protocol !== 'https:') {
    // NetEase's CDN is the one trusted upstream that answers on plain http;
    // every other scheme/host is rejected. The rewrite keeps the proxy on https.
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (LX_APPROVED_MEDIA_HOSTS.has(host)) return true;
  if (isNetEaseMediaHost(url)) return true;
  return [configuredBase(LX_API_BASE), configuredBase(LX_RESOLVER_BASE)]
    .filter((base): base is string => Boolean(base))
    .some((base) => new URL(base).hostname.toLowerCase() === host);
}

/**
 * Maps a resolved URL onto an allowlisted https endpoint. NetEase's resolver
 * returns `http://*.126.net` nodes; the CDN serves the same media over https,
 * so the upgrade is transparent to playback and keeps the proxy on a checked
 * scheme. Anything else is left untouched for `isApprovedLxMedia` to judge.
 */
function approvedMediaUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === 'http:' && isNetEaseMediaHost(url)) {
    url.protocol = 'https:';
  }
  return isApprovedLxMedia(url) ? url : null;
}
const LX_API_KEY = 'share-v3';
const DEFAULT_LEVEL = process.env.LX_DEFAULT_LEVEL || '320';
const REQUEST_TIMEOUT_MS = 20_000;
const CATALOG_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';
const rateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 200, maxEntries: 4_000 });

function unavailableProbe(provider: string, code = 'unavailable'): NextResponse {
  return NextResponse.json(
    { available: false, provider, code },
    { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
  );
}

function expectedMinimumBytes(expectedDuration: number): number {
  // Keep this deliberately conservative: it rejects tiny preview payloads but
  // does not pretend a bitrate is proof that the recording is complete.
  return Math.ceil(expectedDuration * 4_000);
}

function totalResponseBytes(response: Response): number {
  const contentRange = response.headers.get('content-range');
  const total = contentRange?.match(/^bytes \d+-\d+\/(\d+)$/)?.[1];
  if (total) return Number(total);
  const length = response.headers.get('content-length');
  return length ? Number(length) : 0;
}

function catalogResponse(data: unknown): NextResponse {
  const response = NextResponse.json(data);
  setCdnCacheHeaders(response.headers, CATALOG_CACHE_CONTROL);
  return response;
}

function lxHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Request-Key': LX_API_KEY,
  };
  headers['User-Agent'] = 'lx-music-api/1.0';
  return headers;
}

async function upstreamFetch(request: Request, url: string, init: RequestInit = {}): Promise<Response> {
  const mergedHeaders: Record<string, string> = {
    ...(init.headers as Record<string, string>),
    ...lxHeaders(),
  };
  return fetch(url, { ...init, headers: mergedHeaders, signal: requestSignal(request, REQUEST_TIMEOUT_MS) });
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

async function proxyStream(request: Request, streamUrl: string, expireTime?: number): Promise<NextResponse> {
  const requestHeaders = new Headers();
  const range = request.headers.get('range');
  const ifRange = request.headers.get('if-range');
  if (range) requestHeaders.set('range', range);
  if (ifRange) requestHeaders.set('if-range', ifRange);
  requestHeaders.set('User-Agent', 'lx-music-api/1.0');
  requestHeaders.set('X-Request-Key', LX_API_KEY);

  try {
    const fetched = await fetchApprovedMedia(request, streamUrl, {
      isApproved: (url) => isApprovedLxMedia(url),
      headers: requestHeaders,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    // A normal media request must remain an HTTP failure when the approved
    // upstream cannot be fetched. Returning the probe-shaped 200 JSON here
    // makes the browser treat an unavailable track as a successful audio
    // response and prevents playback recovery from trying another source.
    if (!fetched.ok) return fetched.response;
    const { response: upstream, controller, cleanup } = fetched;

    const isSuccessfulMedia = upstream.status >= 200 && upstream.status < 300;
    const contentType = mediaContentType(upstream.headers.get('content-type'));
    if (
      isSuccessfulMedia &&
      (!contentType || (contentType !== 'application/octet-stream' && !contentType.startsWith('audio/')))
    ) {
      closeUpstream(upstream, cleanup);
      return NextResponse.json({ error: 'Upstream returned invalid media' }, { status: 502 });
    }
    if (upstream.status === 206 && !validContentRange(upstream.headers.get('content-range'))) {
      closeUpstream(upstream, cleanup);
      return NextResponse.json({ error: 'Upstream returned an invalid range response' }, { status: 502 });
    }

    const headers = new Headers();
    for (const name of STREAM_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    if (contentType) headers.set('Content-Type', contentType);
    else headers.delete('Content-Type');

    if (expireTime && Number.isFinite(expireTime)) {
      headers.set('X-LX-Expire-Time', String(expireTime));
    }

    if (range || upstream.status === 206) {
      headers.set('Cache-Control', 'private, no-store');
    } else if (upstream.ok) {
      // Resolver URLs are signed/temporary; never retain a proxy response for
      // a day when its origin may expire sooner.
      const now = Date.now();
      const expiryMs = expireTime && expireTime < 10_000_000_000 ? expireTime * 1000 : expireTime;
      const remainingSeconds = expiryMs && expiryMs > now ? Math.floor((expiryMs - now) / 1000) - 30 : 0;
      if (remainingSeconds > 60) {
        const maxAge = Math.min(remainingSeconds, 900);
        setCdnCacheHeaders(headers, `public, s-maxage=${maxAge}, stale-while-revalidate=${Math.min(maxAge, 300)}`);
      } else {
        headers.set('Cache-Control', 'private, no-store');
      }
    }
    headers.set('Vary', 'Range');

    const body = streamBody(upstream, controller, cleanup);
    return new NextResponse(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    return providerFailure(error, 'Stream fetch failed');
  }
}

async function probeStream(request: Request, streamUrl: string, expectedDuration = 0): Promise<NextResponse> {
  const headers = new Headers(lxHeaders());
  headers.set('Range', 'bytes=0-1');

  try {
    const fetched = await fetchApprovedMedia(request, streamUrl, {
      isApproved: (url) => isApprovedLxMedia(url),
      headers,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (!fetched.ok) return fetched.response;

    const { response, cleanup } = fetched;
    const contentType = mediaContentType(response.headers.get('content-type'));
    const validStatus = response.status >= 200 && response.status < 300;
    const validType = contentType === 'application/octet-stream' || Boolean(contentType?.startsWith('audio/'));
    const validRange = response.status !== 206 || validContentRange(response.headers.get('content-range'));
    const totalBytes = totalResponseBytes(response);
    closeUpstream(response, cleanup);

    if (!validStatus || !validType || !validRange) {
      return unavailableProbe('LX Music');
    }

    if (expectedDuration > 0 && totalBytes > 0 && totalBytes < expectedMinimumBytes(expectedDuration)) {
      return unavailableProbe('LX Music', 'short');
    }

    return NextResponse.json(
      { available: true, provider: 'LX Music' },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return providerFailure(error, 'LX Music stream probe failed');
  }
}

const RESOLVE_QUALITY: Record<string, string> = {
  '128': '128k',
  '192': '192k',
  '320': '320k',
  hires: 'hires',
  lossless: 'hires',
};

function resolveQuality(level: string): string {
  return (
    RESOLVE_QUALITY[level] || (Number.isInteger(Number(level)) ? (Number(level) >= 320 ? '320k' : '128k') : '320k')
  );
}

/** Shape the community search API's payload into the one the LX API returns. */
function mapFallbackSearch(payload: unknown): NextResponse {
  const data = payload as {
    code?: number;
    data?: Array<{ id?: number | string; song?: string; singer?: string; album?: string; cover?: string }>;
  };
  const result = Array.isArray(data.data)
    ? data.data.map((item) => ({
        id: item.id,
        name: item.song,
        ar: item.singer ? item.singer.split('/').map((name) => ({ name })) : [],
        al: { name: item.album, picUrl: item.cover, id: item.id },
        platform: 'wy',
        type: 1,
      }))
    : [];
  return catalogResponse({ code: data.code === 200 ? 0 : data.code, data: { result } });
}

function fetchFallbackSearch(req: Request, key: string): Promise<Response> {
  const fallback = new URL(LX_SEARCH_BASE);
  fallback.searchParams.set('word', key);
  return fetch(fallback.toString(), { signal: requestSignal(req, REQUEST_TIMEOUT_MS), headers: lxHeaders() });
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
    return NextResponse.json(
      { error: 'Invalid search type. Use 1=song,2=album,3=artist,4=lyric,5=playlist' },
      { status: 400 },
    );
  }

  try {
    const apiBase = configuredBase(LX_API_BASE);
    if (!apiBase) throw new Error('LX search endpoint is not configured');
    const upstream = new URL(`${apiBase}/search/${type}/${encodeURIComponent(key)}/1`);
    const response = await upstreamFetch(req, upstream.toString());
    if (response.ok) {
      return catalogResponse((await response.json()) as LxSearchResponse);
    }

    const fallbackResponse = await fetchFallbackSearch(req, key);
    if (!fallbackResponse.ok) {
      return NextResponse.json(
        { error: `LX Music upstream error (status ${response.status})` },
        { status: response.status },
      );
    }
    return mapFallbackSearch(await fallbackResponse.json());
  } catch (error) {
    // An aborted request is the caller giving up, not the upstream failing —
    // retrying it against the fallback would only waste a second request.
    if (error instanceof DOMException && error.name === 'AbortError') {
      return providerFailure(error, 'LX Music search failed');
    }
    try {
      const fallbackResponse = await fetchFallbackSearch(req, key);
      if (!fallbackResponse.ok) return providerFailure(error, 'LX Music search failed');
      return mapFallbackSearch(await fallbackResponse.json());
    } catch (fallbackError) {
      return providerFailure(fallbackError, 'LX Music search failed');
    }
  }
}

// Both branches of `handleUrl` interpolate these into an upstream path, so they
// are validated once at the entry rather than per branch. `encodeURIComponent`
// alone is not enough: it leaves `.` untouched, so a `..` segment survives it
// and walks up the resolver's path.
const LX_PLATFORM = /^[a-z]{2,8}$/i;
const LX_RAW_ID = /^[A-Za-z0-9_-]{1,100}$/;

async function handleUrl(req: Request): Promise<NextResponse> {
  const searchParams = new URL(req.url).searchParams;
  const lxSongId = searchParams.get('id');
  const level = searchParams.get('level') || DEFAULT_LEVEL;
  const platform = searchParams.get('platform');
  const rawId = searchParams.get('rawId');
  const type = searchParams.get('type');
  const expectedDuration = Number(searchParams.get('expected'));

  if (!lxSongId) {
    return NextResponse.json({ error: 'Missing LX song id' }, { status: 400 });
  }
  if (!platform) {
    return NextResponse.json({ error: 'Missing platform parameter' }, { status: 400 });
  }
  if (!LX_PLATFORM.test(platform)) {
    return NextResponse.json({ error: 'Invalid LX stream identity' }, { status: 400 });
  }
  // `id` reaches the path whenever `rawId` is absent, so it is held to the same
  // shape as `rawId` — the fallback branch used to accept anything at all.
  const pathId = rawId ?? lxSongId;
  if (!LX_RAW_ID.test(pathId)) {
    return NextResponse.json({ error: 'Invalid LX stream identity' }, { status: 400 });
  }

  const resolvedLevel = resolveQuality(level);

  let streamUrl: string | null = null;
  let expireTime: number | undefined;

  if (rawId && type) {
    const resolverBase = configuredBase(LX_RESOLVER_BASE) || configuredBase(LX_API_BASE);
    if (!resolverBase) return NextResponse.json({ error: 'LX resolver is not configured' }, { status: 503 });
    const directUrl = `${resolverBase}/url/${platform}/${encodeURIComponent(rawId)}/${resolvedLevel}`;
    try {
      const response = await upstreamFetch(req, directUrl);
      if (response.ok) {
        const data = (await response.json()) as LxUrlResponse;
        const resolvedUrl = data.url || data.data?.[0]?.url;
        if (resolvedUrl) {
          const candidate = approvedMediaUrl(resolvedUrl);
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
    streamUrl = `${proxyBase}/url/${platform}/${encodeURIComponent(pathId)}/${resolvedLevel}`;
  }

  if (searchParams.get('probe') === '1') {
    return probeStream(
      req,
      streamUrl,
      Number.isFinite(expectedDuration) && expectedDuration > 45 ? expectedDuration : 0,
    );
  }
  return proxyStream(req, streamUrl, expireTime);
}

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
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
