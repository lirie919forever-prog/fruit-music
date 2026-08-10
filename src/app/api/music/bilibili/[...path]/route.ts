import { NextResponse } from 'next/server';
import { createRateLimiter } from '../../rateLimit';
import {
  STREAM_RESPONSE_HEADERS,
  closeUpstream,
  fetchApprovedMedia,
  mediaContentType,
  mediaHostAllowlist,
  providerFailure,
  requestSignal,
  setCdnCacheHeaders,
  streamBody,
  validContentRange,
} from '../../streamProxy';

const BILIBILI_API = 'https://api.bilibili.com';
const BILIBILI_BVID = /^BV[0-9A-Za-z]{10}$/;
const BILIBILI_USER_AGENT = 'Mozilla/5.0 (compatible; Marea/1.0; +https://www.bilibili.com/)';
const BILIBILI_HEADERS = {
  referer: 'https://www.bilibili.com/',
  'user-agent': BILIBILI_USER_AGENT,
} as const;
const BILIBILI_MEDIA_HOSTS = mediaHostAllowlist([], ['.bilivideo.com', '.bilivideo.cn']);
const REQUEST_TIMEOUT_MS = 15_000;
const CATALOG_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';
const FULL_TRACK_EXPECTATION_THRESHOLD_SECONDS = 45;
const rateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 120, maxEntries: 4_000 });

interface BilibiliPage {
  cid?: number;
  duration?: number;
}

interface BilibiliViewPayload {
  code?: number;
  data?: {
    cid?: number;
    pages?: BilibiliPage[];
  };
}

interface BilibiliMedia {
  baseUrl?: string;
  base_url?: string;
  backupUrl?: string[];
  backup_url?: string[];
  mimeType?: string;
  mime_type?: string;
  bandwidth?: number;
}

interface BilibiliPlayUrlPayload {
  code?: number;
  data?: {
    dash?: {
      audio?: BilibiliMedia[];
    };
  };
}

interface BilibiliSearchPayload {
  code?: number;
  data?: {
    result?: unknown[];
  };
}

function catalogResponse(data: unknown): NextResponse {
  const response = NextResponse.json(data);
  setCdnCacheHeaders(response.headers, CATALOG_CACHE_CONTROL);
  return response;
}

function boundedLimit(value: string | null): NextResponse | string {
  if (value === null) return '40';
  if (!/^\d+$/.test(value)) return NextResponse.json({ error: 'Invalid limit' }, { status: 400 });
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    return NextResponse.json({ error: 'Limit must be between 1 and 50' }, { status: 400 });
  }
  return String(limit);
}

function queryValue(value: string | null): NextResponse | string {
  const query = value?.trim();
  if (!query || query.length > 200) return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
  return query;
}

function bvidValue(value: string | undefined): NextResponse | string {
  if (!value || !BILIBILI_BVID.test(value))
    return NextResponse.json({ error: 'Invalid Bilibili video ID' }, { status: 400 });
  return value;
}

async function bilibiliFetch(request: Request, endpoint: string, params: Record<string, string>): Promise<Response> {
  const url = new URL(endpoint, BILIBILI_API);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return fetch(url, {
    signal: requestSignal(request, REQUEST_TIMEOUT_MS),
    headers: BILIBILI_HEADERS,
  });
}

async function handleSearch(request: Request): Promise<NextResponse> {
  const searchParams = new URL(request.url).searchParams;
  const query = queryValue(searchParams.get('q'));
  if (query instanceof NextResponse) return query;
  const limit = boundedLimit(searchParams.get('limit'));
  if (limit instanceof NextResponse) return limit;

  try {
    const upstream = await bilibiliFetch(request, '/x/web-interface/search/type', {
      search_type: 'video',
      keyword: query,
      page: '1',
      page_size: limit,
    });
    if (!upstream.ok)
      return NextResponse.json({ error: `Bilibili upstream error (status ${upstream.status})` }, { status: 502 });
    const payload = (await upstream.json()) as BilibiliSearchPayload;
    if (payload.code !== undefined && payload.code !== 0) {
      return NextResponse.json({ error: 'Bilibili upstream error' }, { status: 502 });
    }
    return catalogResponse({ results: Array.isArray(payload.data?.result) ? payload.data.result : [] });
  } catch (error) {
    return providerFailure(error, 'Bilibili search failed');
  }
}

function publicMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return BILIBILI_MEDIA_HOSTS(url) ? url.toString() : null;
  } catch {
    return null;
  }
}

async function resolveBilibiliAudioUrl(request: Request, bvid: string): Promise<string | null> {
  const viewResponse = await bilibiliFetch(request, '/x/web-interface/view', { bvid });
  if (!viewResponse.ok) return null;
  const view = (await viewResponse.json()) as BilibiliViewPayload;
  if (view.code !== undefined && view.code !== 0) return null;
  const cid = view.data?.pages?.[0]?.cid ?? view.data?.cid;
  if (typeof cid !== 'number' || !Number.isSafeInteger(cid) || cid <= 0) return null;

  const playUrlResponse = await bilibiliFetch(request, '/x/player/playurl', {
    bvid,
    cid: String(cid),
    fnval: '16',
    fnver: '0',
    fourk: '0',
  });
  if (!playUrlResponse.ok) return null;
  const playUrl = (await playUrlResponse.json()) as BilibiliPlayUrlPayload;
  if (playUrl.code !== undefined && playUrl.code !== 0) return null;

  const audio = (playUrl.data?.dash?.audio || [])
    .filter((item) => {
      const mime = (item.mimeType || item.mime_type || '').toLowerCase();
      return mime.startsWith('audio/');
    })
    .sort((left, right) => (right.bandwidth || 0) - (left.bandwidth || 0));

  for (const item of audio) {
    const direct = publicMediaUrl(item.baseUrl || item.base_url);
    if (direct) return direct;
    for (const backup of [...(item.backupUrl || []), ...(item.backup_url || [])]) {
      const fallback = publicMediaUrl(backup);
      if (fallback) return fallback;
    }
  }
  return null;
}

interface ProbeResult {
  available: boolean;
  code?: 'short' | 'unavailable';
}

function expectedMinimumBytes(expectedDuration: number): number {
  return Math.ceil(expectedDuration * 4_000);
}

function totalResponseBytes(response: Response): number {
  const contentRange = response.headers.get('content-range');
  const total = contentRange?.match(/^bytes \d+-\d+\/(\d+)$/)?.[1];
  if (total) return Number(total);
  const length = response.headers.get('content-length');
  return length ? Number(length) : 0;
}

async function probeStream(request: Request, streamUrl: string, expectedDuration: number): Promise<ProbeResult> {
  const headers = new Headers(BILIBILI_HEADERS);
  headers.set('Range', 'bytes=0-1');
  const fetched = await fetchApprovedMedia(request, streamUrl, {
    isApproved: BILIBILI_MEDIA_HOSTS,
    headers,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  if (!fetched.ok) return { available: false, code: 'unavailable' };
  const { response, cleanup } = fetched;
  const contentType = mediaContentType(response.headers.get('content-type'));
  const validStatus = response.status >= 200 && response.status < 300;
  const validType = contentType === 'application/octet-stream' || Boolean(contentType?.startsWith('audio/'));
  const validRange = response.status !== 206 || validContentRange(response.headers.get('content-range'));
  const totalBytes = totalResponseBytes(response);
  closeUpstream(response, cleanup);
  if (!validStatus || !validType || !validRange) return { available: false, code: 'unavailable' };
  if (expectedDuration > 0 && totalBytes > 0 && totalBytes < expectedMinimumBytes(expectedDuration)) {
    return { available: false, code: 'short' };
  }
  return { available: true };
}

async function proxyStream(request: Request, streamUrl: string): Promise<NextResponse> {
  const headers = new Headers(BILIBILI_HEADERS);
  const range = request.headers.get('range');
  const ifRange = request.headers.get('if-range');
  if (range) headers.set('range', range);
  if (ifRange) headers.set('if-range', ifRange);

  try {
    const fetched = await fetchApprovedMedia(request, streamUrl, {
      isApproved: BILIBILI_MEDIA_HOSTS,
      headers,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (!fetched.ok) return fetched.response;
    const { response: upstream, controller, cleanup } = fetched;
    const contentType = mediaContentType(upstream.headers.get('content-type'));
    const validStatus = upstream.status >= 200 && upstream.status < 300;
    const validAudioType = contentType === 'application/octet-stream' || Boolean(contentType?.startsWith('audio/'));
    if (validStatus && !validAudioType) {
      closeUpstream(upstream, cleanup);
      return NextResponse.json({ error: 'Bilibili returned a non-audio stream' }, { status: 502 });
    }
    if (upstream.status === 206 && !validContentRange(upstream.headers.get('content-range'))) {
      closeUpstream(upstream, cleanup);
      return NextResponse.json({ error: 'Upstream returned an invalid range response' }, { status: 502 });
    }

    const responseHeaders = new Headers();
    for (const name of STREAM_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) responseHeaders.set(name, value);
    }
    if (contentType)
      responseHeaders.set('Content-Type', contentType === 'application/octet-stream' ? 'audio/mp4' : contentType);
    responseHeaders.set('Cache-Control', range || upstream.status === 206 ? 'private, no-store' : 'private, no-store');
    responseHeaders.set('Vary', 'Range');
    return new NextResponse(streamBody(upstream, controller, cleanup), {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return providerFailure(error, 'Bilibili stream fetch failed');
  }
}

async function handleStream(request: Request, bvidParam: string | undefined): Promise<NextResponse> {
  const bvid = bvidValue(bvidParam);
  if (bvid instanceof NextResponse) return bvid;
  const searchParams = new URL(request.url).searchParams;
  const probe = searchParams.get('probe');
  if (probe !== null && probe !== '1') return NextResponse.json({ error: 'Invalid Bilibili probe' }, { status: 400 });
  const expected = Number(searchParams.get('expected'));
  const expectedDuration =
    Number.isFinite(expected) && expected > FULL_TRACK_EXPECTATION_THRESHOLD_SECONDS ? expected : 0;

  try {
    const streamUrl = await resolveBilibiliAudioUrl(request, bvid);
    if (!streamUrl) {
      return probe === '1'
        ? NextResponse.json({ available: false, provider: 'Bilibili', code: 'unavailable' })
        : new NextResponse('Bilibili stream unavailable', { status: 404 });
    }
    if (probe === '1') {
      const result = await probeStream(request, streamUrl, expectedDuration);
      return NextResponse.json(
        { ...result, provider: 'Bilibili' },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    return proxyStream(request, streamUrl);
  } catch (error) {
    return providerFailure(error, 'Bilibili stream resolve failed');
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const [resource, ...rest] = (await params).path || [];
  const limited = rateLimit(request, resource === 'stream' ? 'bilibili:stream' : 'bilibili:search');
  if (limited) return limited;
  if (resource === 'tracks' && rest.length === 0) return handleSearch(request);
  if (resource === 'stream' && rest.length === 1) return handleStream(request, rest[0]);
  return NextResponse.json({ error: `Unknown Bilibili endpoint: ${resource ?? ''}` }, { status: 400 });
}
