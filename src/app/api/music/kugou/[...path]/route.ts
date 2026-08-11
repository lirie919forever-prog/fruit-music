import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createRateLimiter } from '../../rateLimit';
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
import { isKugouMediaHost } from '@/lib/kugouMedia';

export const runtime = 'nodejs';

const KUGOU_SEARCH_BASE = 'http://mobilecdn.kugou.com/api/v3/search/song';
const KUGOU_RESOLVER_BASE = 'http://trackercdn.kugou.com/i/v2/';
const KUGOU_KEY_SALT = 'kgcloudv2';
const REQUEST_TIMEOUT_MS = 20_000;
const CATALOG_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';
const HASH_RE = /^[a-f0-9]{32}$/;
const rateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 400, maxEntries: 8_000 });

function catalogResponse(data: unknown): NextResponse {
  const response = NextResponse.json(data);
  setCdnCacheHeaders(response.headers, CATALOG_CACHE_CONTROL);
  return response;
}

interface KugouSearchItem {
  hash?: string;
  songname?: string;
  songname_original?: string;
  singername?: string;
  album_name?: string;
  album_id?: string | number;
  album_audio_id?: string | number;
  duration?: number | string;
  extname?: string;
  filesize?: number | string;
  bitrate?: number | string;
  pay_type?: number | string;
  privilege?: number | string;
  filename?: string;
}

interface KugouSearchPayload {
  status?: number;
  err_code?: number;
  data?: { total?: number; info?: KugouSearchItem[] };
}

interface KugouResolverPayload {
  status?: number;
  url?: string | string[];
  bitRate?: number;
  fileSize?: number;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveKey(hash: string): string {
  return createHash('md5').update(hash + KUGOU_KEY_SALT).digest('hex');
}

async function handleSearch(request: Request): Promise<NextResponse> {
  const searchParams = new URL(request.url).searchParams;
  const key = searchParams.get('q')?.trim();
  if (!key) return NextResponse.json({ error: 'Missing search key' }, { status: 400 });
  if (key.length > 200) return NextResponse.json({ error: 'Search key too long' }, { status: 400 });

  const url = new URL(KUGOU_SEARCH_BASE);
  url.searchParams.set('keyword', key);
  url.searchParams.set('page', '1');
  url.searchParams.set('pagesize', '40');
  url.searchParams.set('format', 'json');

  try {
    const response = await fetch(url.toString(), {
      signal: requestSignal(request, REQUEST_TIMEOUT_MS),
      headers: { 'User-Agent': 'Marea/1.0' },
    });
    if (!response.ok) {
      return NextResponse.json({ error: `Kugou upstream error (status ${response.status})` }, { status: 502 });
    }
    const payload = (await response.json()) as KugouSearchPayload;
    const info = Array.isArray(payload.data?.info) ? payload.data?.info ?? [] : [];
    const results = info
      .filter((item) => HASH_RE.test(text(item.hash)))
      .map((item) => ({
        hash: text(item.hash),
        songname: text(item.songname) || text(item.songname_original),
        singername: text(item.singername),
        album_name: text(item.album_name),
        album_id: item.album_id,
        album_audio_id: item.album_audio_id,
        duration: Number(item.duration) || 0,
        extname: text(item.extname) || 'mp3',
        filesize: Number(item.filesize) || 0,
        bitrate: Number(item.bitrate) || 0,
        pay_type: Number(item.pay_type) || 0,
        privilege: Number(item.privilege) || 0,
        filename: text(item.filename),
      }));
    return catalogResponse({ results });
  } catch (error) {
    return providerFailure(error, 'Kugou search failed');
  }
}

interface ProbeResult {
  available: boolean;
  code?: 'short' | 'unavailable';
}

function unavailableProbe(code: 'short' | 'unavailable' = 'unavailable'): NextResponse {
  return NextResponse.json(
    { available: false, provider: 'Kugou', code },
    { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
  );
}

function expectedMinimumBytes(expectedDuration: number): number {
  // A full music recording at 32 kbps is already larger than this floor. It
  // catches the common 20-30 second preview returned by a resolver while
  // leaving the decoder-level duration check as the final authority.
  return Math.ceil(expectedDuration * 4_000);
}

function totalResponseBytes(response: Response): number {
  const contentRange = response.headers.get('content-range');
  const total = contentRange?.match(/^bytes \d+-\d+\/(\d+)$/)?.[1];
  if (total) return Number(total);
  const length = response.headers.get('content-length');
  return length ? Number(length) : 0;
}

function canonicalizeStreamUrl(value: string): string {
  return value.replace(/^http:/i, 'https:');
}

function pickStreamUrl(payload: KugouResolverPayload): string | null {
  const raw = payload.url;
  if (typeof raw === 'string' && raw) return canonicalizeStreamUrl(raw);
  if (Array.isArray(raw)) {
    for (const candidate of raw) {
      if (typeof candidate === 'string' && candidate) return canonicalizeStreamUrl(candidate);
    }
  }
  return null;
}

type ResolveOutcome = { ok: true; url: string } | { ok: false; code: ProbeResult['code'] };

async function resolveKugouStream(request: Request, hash: string): Promise<ResolveOutcome> {
  const key = resolveKey(hash);
  const url = new URL(KUGOU_RESOLVER_BASE);
  url.searchParams.set('key', key);
  url.searchParams.set('hash', hash);
  url.searchParams.set('br', '128');
  url.searchParams.set('appid', '1005');
  url.searchParams.set('pid', '2');
  url.searchParams.set('behavior', 'play');
  url.searchParams.set('cmd', '25');
  const response = await fetch(url.toString(), {
    signal: requestSignal(request, REQUEST_TIMEOUT_MS),
    headers: { 'User-Agent': 'Marea/1.0' },
  });
  if (!response.ok) return { ok: false, code: 'unavailable' };
  const payload = (await response.json()) as KugouResolverPayload;
  if (payload.status !== 1) return { ok: false, code: 'unavailable' };
  const streamUrl = pickStreamUrl(payload);
  if (!streamUrl) return { ok: false, code: 'unavailable' };
  try {
    if (!isKugouMediaHost(new URL(streamUrl))) return { ok: false, code: 'unavailable' };
  } catch {
    return { ok: false, code: 'unavailable' };
  }
  return { ok: true, url: streamUrl };
}

async function probeStream(request: Request, streamUrl: string, expectedDuration = 0): Promise<ProbeResult> {
  const headers = new Headers({ 'User-Agent': 'Marea/1.0', Range: 'bytes=0-1' });
  const fetched = await fetchApprovedMedia(request, streamUrl, {
    isApproved: isKugouMediaHost,
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
  const requestHeaders = new Headers();
  const range = request.headers.get('range');
  const ifRange = request.headers.get('if-range');
  if (range) requestHeaders.set('range', range);
  if (ifRange) requestHeaders.set('if-range', ifRange);
  requestHeaders.set('User-Agent', 'Marea/1.0');

  try {
    const fetched = await fetchApprovedMedia(request, streamUrl, {
      isApproved: isKugouMediaHost,
      headers: requestHeaders,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
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
    headers.set('Cache-Control', range || upstream.status === 206 ? 'private, no-store' : 'public, s-maxage=900');
    headers.set('Vary', 'Range');

    return new NextResponse(streamBody(upstream, controller, cleanup), {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    return providerFailure(error, 'Kugou stream fetch failed');
  }
}

async function handleStream(request: Request, hash: string): Promise<NextResponse> {
  const searchParams = new URL(request.url).searchParams;
  const isProbe = searchParams.get('probe') === '1';
  const expectedDuration = Number(searchParams.get('expected'));
  const normalizedExpectedDuration =
    Number.isFinite(expectedDuration) && expectedDuration > 45 ? expectedDuration : 0;
  if (!HASH_RE.test(hash)) return NextResponse.json({ error: 'Invalid Kugou hash' }, { status: 400 });

  try {
    const resolved = await resolveKugouStream(request, hash);
    if (!resolved.ok) {
      return isProbe
        ? unavailableProbe(resolved.code)
        : NextResponse.json(
            { error: 'Kugou stream unavailable', code: resolved.code },
            { status: 502,
              headers: { 'Cache-Control': 'private, no-store' } },
          );
    }
    if (isProbe) {
      const result = await probeStream(request, resolved.url, normalizedExpectedDuration);
      if (result.available) {
        return NextResponse.json(
          { available: true, provider: 'Kugou' },
          { headers: { 'Cache-Control': 'private, no-store' } },
        );
      }
      return unavailableProbe(result.code);
    }
    return proxyStream(request, resolved.url);
  } catch (error) {
    return providerFailure(error, 'Kugou stream resolve failed');
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const parts = (await params).path || [];
  const [resource, ...rest] = parts;
  const limited = rateLimit(request, resource === 'stream' ? 'kugou:stream' : 'kugou:search');
  if (limited) return limited;
  if (resource === 'tracks') return handleSearch(request);
  if (resource === 'stream') {
    const hash = rest[0];
    if (!hash) return NextResponse.json({ error: 'Missing Kugou hash' }, { status: 400 });
    return handleStream(request, hash);
  }
  return NextResponse.json({ error: `Unknown kugou endpoint: ${resource ?? ''}` }, { status: 400 });
}