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
import { repairUtf8Mojibake } from '@/lib/repairUtf8Mojibake';

const KUWO_SEARCH_BASE = 'http://search.kuwo.cn/r.s';
const KUWO_RESOLVER_BASE = 'https://antiserver.kuwo.cn/anti.s';
const REQUEST_TIMEOUT_MS = 20_000;
const CATALOG_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';
const KUWO_MOBILE_ONLY_MESSAGE = '\u5f53\u524d\u97f3\u4e50\u53ea\u5728\u9177\u6211\u624b\u673a\u7aef';
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

function isStringDelimiter(text: string, index: number): boolean {
  while (/\s/.test(text[index] ?? '')) index += 1;
  return index >= text.length || ',:]}'.includes(text[index]);
}

function isMalformedFieldBoundary(text: string, index: number): boolean {
  // A small number of Kuwo records contain an unescaped comma followed by the
  // next single-quoted field, for example `ALBUM:'...&quot;,\'ALBUMID':...`.
  // Recover only when the boundary is unambiguous; commas inside normal track
  // names must remain part of the value.
  return text[index] === ',' && /^,\s*'[A-Za-z_$][\w$]*'\s*:/.test(text.slice(index));
}

/** Kuwo returns JSON-shaped data with single-quoted strings. Convert only the
 * string delimiters so apostrophes inside artist names do not corrupt parsing. */
function normalizeKuwoPayload(text: string): string | null {
  let output = '';
  let index = 0;

  while (index < text.length) {
    const character = text[index];
    if (character === '"') {
      output += character;
      index += 1;
      while (index < text.length) {
        const current = text[index];
        output += current;
        index += 1;
        if (current === '\\' && index < text.length) {
          output += text[index];
          index += 1;
        } else if (current === '"') {
          break;
        }
      }
      continue;
    }

    if (character !== "'") {
      output += character;
      index += 1;
      continue;
    }

    let value = '';
    let cursor = index + 1;
    let closed = false;
    while (cursor < text.length) {
      const current = text[cursor];
      if (current === '\\' && cursor + 1 < text.length) {
        const escaped = text[cursor + 1];
        value += escaped === 'n' ? '\n' : escaped === 'r' ? '\r' : escaped === 't' ? '\t' : escaped;
        cursor += 2;
        continue;
      }
      if (current === "'" && isStringDelimiter(text, cursor + 1)) {
        closed = true;
        cursor += 1;
        break;
      }
      if (isMalformedFieldBoundary(text, cursor)) {
        closed = true;
        break;
      }
      value += current;
      cursor += 1;
    }
    if (!closed) return null;
    output += JSON.stringify(value);
    index = cursor;
  }

  return output;
}

function parseKuwoPayload(text: string): unknown {
  try {
    const normalized = normalizeKuwoPayload(text);
    return normalized ? JSON.parse(normalized) : null;
  } catch {
    return null;
  }
}

function repairKuwoPayload(value: unknown): unknown {
  if (typeof value === 'string') return repairUtf8Mojibake(value);
  if (Array.isArray(value)) return value.map(repairKuwoPayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, repairKuwoPayload(entry)]));
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
    const payload = repairKuwoPayload(parseKuwoPayload(await response.text()));
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

function unavailableProbe(provider: string, code = 'unavailable'): NextResponse {
  return NextResponse.json(
    { available: false, provider, code },
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

async function handleUrl(request: Request): Promise<NextResponse> {
  const searchParams = new URL(request.url).searchParams;
  const rid = searchParams.get('rid');
  const bitrate = searchParams.get('br') || '320kmp3';
  const expectedDuration = Number(searchParams.get('expected'));
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
    const streamBody = repairUtf8Mojibake((await response.text()).trim());
    if (streamBody.replace(/\s+/g, '').includes(KUWO_MOBILE_ONLY_MESSAGE)) {
      if (searchParams.get('probe') === '1') return unavailableProbe('Kuwo', 'mobile_only');
      return NextResponse.json(
        {
          error: 'This track is only available in the Kuwo mobile app.',
          code: 'mobile_only',
          provider: 'Kuwo',
        },
        { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    let candidate: URL;
    try {
      candidate = new URL(streamBody);
    } catch {
      if (searchParams.get('probe') === '1') return unavailableProbe('Kuwo');
      return NextResponse.json({ error: 'Kuwo returned an invalid stream URL' }, { status: 502 });
    }
    if (!isKuwoMediaHost(candidate)) {
      if (searchParams.get('probe') === '1') return unavailableProbe('Kuwo');
      return NextResponse.json({ error: 'Kuwo returned an unapproved stream host' }, { status: 502 });
    }
    if (searchParams.get('probe') === '1') {
      return probeStream(
        request,
        candidate.toString(),
        Number.isFinite(expectedDuration) && expectedDuration > 45 ? expectedDuration : 0,
      );
    }
    return proxyStream(request, candidate.toString());
  } catch (error) {
    return providerFailure(error, 'Kuwo stream resolve failed');
  }
}

async function probeStream(request: Request, streamUrl: string, expectedDuration = 0): Promise<NextResponse> {
  const headers = new Headers({ 'User-Agent': 'Marea/1.0', Range: 'bytes=0-1' });
  try {
    const fetched = await fetchApprovedMedia(request, streamUrl, {
      isApproved: isKuwoMediaHost,
      headers,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (!fetched.ok) return unavailableProbe('Kuwo');
    const { response, cleanup } = fetched;
    const contentType = mediaContentType(response.headers.get('content-type'));
    const validStatus = response.status >= 200 && response.status < 300;
    const validType = contentType === 'application/octet-stream' || Boolean(contentType?.startsWith('audio/'));
    const validRange = response.status !== 206 || validContentRange(response.headers.get('content-range'));
    const totalBytes = totalResponseBytes(response);
    closeUpstream(response, cleanup);
    if (!validStatus || !validType || !validRange) {
      return unavailableProbe('Kuwo');
    }
    if (expectedDuration > 0 && totalBytes > 0 && totalBytes < expectedMinimumBytes(expectedDuration)) {
      return unavailableProbe('Kuwo', 'short');
    }
    return NextResponse.json(
      { available: true, provider: 'Kuwo' },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return providerFailure(error, 'Kuwo stream probe failed');
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const [resource] = (await params).path || [];
  const limited = rateLimit(request, resource === 'url' ? 'kuwo:url' : 'kuwo:search');
  if (limited) return limited;
  if (resource === 'search') return handleSearch(request);
  if (resource === 'url') return handleUrl(request);
  return NextResponse.json({ error: `Unknown kuwo endpoint: ${resource ?? ''}` }, { status: 400 });
}
