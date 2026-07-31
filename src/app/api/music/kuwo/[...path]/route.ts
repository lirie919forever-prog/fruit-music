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

const KUWO_SEARCH_BASE = 'http://search.kuwo.cn/r.s';
const KUWO_RESOLVER_BASE = 'https://antiserver.kuwo.cn/anti.s';
const REQUEST_TIMEOUT_MS = 20_000;
const CATALOG_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';
const rateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 200, maxEntries: 4_000 });

function catalogResponse(data: unknown): NextResponse {
  const response = NextResponse.json(data);
  setCdnCacheHeaders(response.headers, CATALOG_CACHE_CONTROL);
  return response;
}

function isKuwoMediaHost(url: URL): boolean {
  if (url.protocol !== 'http:' || url.username || url.password || url.port || url.hash) return false;
  const host = url.hostname.toLowerCase();
  return host === 'sycdn.kuwo.cn' || host.endsWith('.sycdn.kuwo.cn');
}

function parseKuwoPayload(text: string): unknown {
  try {
    return JSON.parse(text.replace(/'/g, '"'));
  } catch {
    return null;
  }
}

async function handleSearch(request: Request): Promise<NextResponse> {
  const searchParams = new URL(request.url).searchParams;
  const key = searchParams.get('key')?.trim();
  if (!key) return NextResponse.json({ error: 'Missing search key' }, { status: 400 });
  if (key.length > 200) return NextResponse.json({ error: 'Search key too long' }, { status: 400 });

  const url = new URL(KUWO_SEARCH_BASE);
  url.searchParams.set('all', key);
  url.searchParams.set('ft', 'music');
  url.searchParams.set('itemset', 'web_2013');
  url.searchParams.set('client', 'kt');
  url.searchParams.set('pn', '0');
  url.searchParams.set('rn', '50');
  url.searchParams.set('rformat', 'json');
  url.searchParams.set('encoding', 'utf8');

  try {
    const response = await fetch(url, {
      signal: requestSignal(request, REQUEST_TIMEOUT_MS),
      headers: { 'User-Agent': 'Marea/1.0' },
    });
    if (!response.ok) {
      return NextResponse.json({ error: `Kuwo upstream error (status ${response.status})` }, { status: 502 });
    }
    const payload = parseKuwoPayload(await response.text());
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: 'Kuwo returned invalid search data' }, { status: 502 });
    }
    return catalogResponse(payload);
  } catch (error) {
    return providerFailure(error, 'Kuwo search failed');
  }
}

const KUWO_ID = /^\d{1,20}$/;
const KUWO_BITRATE = /^(?:128kmp3|192kmp3|320kmp3)$/;

async function handleUrl(request: Request): Promise<NextResponse> {
  const searchParams = new URL(request.url).searchParams;
  const rid = searchParams.get('rid');
  const bitrate = searchParams.get('br') || '320kmp3';
  if (!rid || !KUWO_ID.test(rid)) return NextResponse.json({ error: 'Invalid Kuwo track id' }, { status: 400 });
  if (!KUWO_BITRATE.test(bitrate)) return NextResponse.json({ error: 'Invalid Kuwo bitrate' }, { status: 400 });

  const url = new URL(KUWO_RESOLVER_BASE);
  url.searchParams.set('format', 'mp3');
  url.searchParams.set('rid', rid);
  url.searchParams.set('type', 'convert_url');
  url.searchParams.set('br', bitrate);

  try {
    const response = await fetch(url, {
      signal: requestSignal(request, REQUEST_TIMEOUT_MS),
      headers: { 'User-Agent': 'Marea/1.0' },
    });
    if (!response.ok) {
      return NextResponse.json({ error: `Kuwo resolver error (status ${response.status})` }, { status: 502 });
    }
    const streamUrl = (await response.text()).trim();
    let candidate: URL;
    try {
      candidate = new URL(streamUrl);
    } catch {
      return NextResponse.json({ error: 'Kuwo returned an invalid stream URL' }, { status: 502 });
    }
    if (!isKuwoMediaHost(candidate)) {
      return NextResponse.json({ error: 'Kuwo returned an unapproved stream host' }, { status: 502 });
    }
    return proxyStream(request, candidate.toString());
  } catch (error) {
    return providerFailure(error, 'Kuwo stream resolve failed');
  }
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
      isApproved: isKuwoMediaHost,
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
    return providerFailure(error, 'Kuwo stream fetch failed');
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const [resource] = (await params).path || [];
  const limited = rateLimit(request, resource === 'url' ? 'kuwo:url' : 'kuwo:search');
  if (limited) return limited;
  if (resource === 'search') return handleSearch(request);
  if (resource === 'url') return handleUrl(request);
  return NextResponse.json({ error: `Unknown kuwo endpoint: ${resource ?? ''}` }, { status: 400 });
}
