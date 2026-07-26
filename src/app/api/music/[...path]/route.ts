import { NextRequest, NextResponse } from 'next/server';
import { classifyRoute } from '../routeClassification';
import { createRateLimiter } from '../rateLimit';
import {
  STREAM_RESPONSE_HEADERS,
  closeUpstream,
  fetchApprovedMedia,
  mediaHostAllowlist,
  providerFailure,
  requestSignal,
  setCdnCacheHeaders,
  streamBody,
  validContentRange,
  type ApprovedMediaHost,
} from '../streamProxy';

const JAMENDO_API = 'https://api.jamendo.com/v3.0';
const ITUNES_API = 'https://itunes.apple.com';
// Every preview sampled across five unrelated searches came from this single
// host, so the allowlist is a host rather than a suffix match. A preview served
// from anywhere else is treated as unavailable rather than proxied blind.
const ITUNES_PREVIEW_HOST = 'audio-ssl.itunes.apple.com';
const ITUNES_ENTITIES = new Set(['song', 'album', 'musicArtist']);
const ITUNES_COUNTRY = /^[a-z]{2}$/;
const ITUNES_MAX_LOOKUP_IDS = 50;
const REQUEST_TIMEOUT_MS = 15_000;
const NUMERIC_ID = /^[1-9]\d{0,15}$/;
const ARCHIVE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const CCMIXTER_MEDIA_HOSTS = new Set(['ccmixter.org', 'www.ccmixter.org']);
const ARCHIVE_ENRICHMENT_CONCURRENCY = 4;
const NON_MUSIC_ARCHIVE_TERMS =
  /\b(audiobook|audio book|librivox|podcast|spoken word|radio (talk|conversation)|lecture|sermon|philosophy|literature|novel|poetry reading)\b/i;
const CATALOG_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';
const FULL_STREAM_CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=604800';
const MAX_STREAM_REDIRECTS = 3;
// ccMixter's media host rejects requests that arrive without the referer its
// own pages send, so every track would otherwise fail with 403.
const CCMIXTER_MEDIA_HEADERS = {
  referer: 'https://ccmixter.org/',
  'user-agent': 'Mozilla/5.0 (compatible; Marea/1.0; +https://ccmixter.org/)',
} as const;
// ccMixter's `f=json` mode returns the payload in an X-JSON response header
// rather than the body, and it is the only mode carrying file and license
// data. That header exceeds Node's default 16 KB cap after a few records, so
// the server runs with --max-http-header-size raised (see package.json) and
// requests a whole page at once. Where that cap is not in effect the page
// shrinks on overflow instead of failing, at the cost of extra round trips.
const CCMIXTER_PAGE_SIZE = 100;
const CCMIXTER_MAX_RECORDS = 100;
const rateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 120, maxEntries: 4_000 });

function catalogResponse(data: unknown): NextResponse {
  const response = NextResponse.json(data);
  // Providers intermittently answer a valid request with zero records. Caching
  // that would pin an empty catalog in front of every client for the whole TTL,
  // so only responses that actually carry records are cached.
  setCdnCacheHeaders(response.headers, isEmptyCatalog(data) ? 'private, no-store' : CATALOG_CACHE_CONTROL);
  return response;
}

function isEmptyCatalog(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  // Both the proxy's own `{ results }` envelope and Jamendo's upstream payload
  // expose the records under `results`.
  const results = (data as { results?: unknown }).results;
  return Array.isArray(results) && results.length === 0;
}

function validMediaUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      CCMIXTER_MEDIA_HOSTS.has(url.hostname.toLowerCase())
      ? url
      : null;
  } catch {
    return null;
  }
}

function upstreamFetch(request: Request, url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: requestSignal(request, REQUEST_TIMEOUT_MS) });
}

function numericId(value: string | undefined, label: string): NextResponse | string {
  if (!value) return NextResponse.json({ error: `Missing ${label}` }, { status: 400 });
  if (!NUMERIC_ID.test(value)) return NextResponse.json({ error: `Invalid ${label}` }, { status: 400 });
  return value;
}

function archiveId(value: string | undefined): NextResponse | string {
  if (!value) return NextResponse.json({ error: 'Missing identifier' }, { status: 400 });
  if (!ARCHIVE_ID.test(value)) return NextResponse.json({ error: 'Invalid identifier' }, { status: 400 });
  return value;
}

function parseDuration(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
  const parts = value.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function scalar(value: unknown): string {
  if (Array.isArray(value)) return scalar(value[0]);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function safeArchiveFilename(name: string): boolean {
  return (
    !name.startsWith('/') &&
    !name.includes('\\') &&
    !/[\x00-\x1f]/.test(name) &&
    name.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

interface ArchiveFile {
  name?: string;
  format?: string;
  size?: string | number;
  length?: string | number;
  bitrate?: string | number;
  private?: string;
}

function playableArchiveFile(file: ArchiveFile): file is ArchiveFile & { name: string } {
  return (
    typeof file.name === 'string' &&
    safeArchiveFilename(file.name) &&
    file.private !== 'true' &&
    (file.format?.toLowerCase().includes('mp3') === true || file.name.toLowerCase().endsWith('.mp3')) &&
    parseDuration(file.length) > 0
  );
}

function chooseArchiveFile(files: ArchiveFile[] | undefined): (ArchiveFile & { name: string }) | null {
  const playable = (files || []).filter(playableArchiveFile);
  playable.sort((left, right) => {
    const original =
      Number(right.format?.toLowerCase().includes('vbr mp3')) - Number(left.format?.toLowerCase().includes('vbr mp3'));
    if (original !== 0) return original;
    const size = Number(right.size || 0) - Number(left.size || 0);
    return size || left.name.localeCompare(right.name);
  });
  return playable[0] || null;
}

function archiveLicense(value: unknown): { name: string; url: string } | null {
  const candidates = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    try {
      const url = new URL(candidate);
      if (!['creativecommons.org', 'www.creativecommons.org'].includes(url.hostname)) continue;
      const labels: Array<[string, string]> = [
        ['/by-nc-nd/', 'CC BY-NC-ND'],
        ['/by-nc-sa/', 'CC BY-NC-SA'],
        ['/by-nc/', 'CC BY-NC'],
        ['/by-nd/', 'CC BY-ND'],
        ['/by-sa/', 'CC BY-SA'],
        ['/by/', 'CC BY'],
        ['/publicdomain/zero/', 'CC0'],
      ];
      const name = labels.find(([part]) => url.pathname.toLowerCase().includes(part))?.[1];
      if (!name) continue;
      url.protocol = 'https:';
      return { name, url: url.toString() };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Maps items concurrently, stopping as soon as `wanted` results are collected.
 *
 * Archive enrichment costs one upstream metadata request per candidate, and the
 * candidate pool is several times the requested limit. Without the early exit a
 * single search issues dozens of extra requests, which starves the connection
 * pool and makes unrelated provider requests fail.
 */
async function mapConcurrent<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U | null>,
  wanted = Number.POSITIVE_INFINITY,
): Promise<U[]> {
  const output: U[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length && output.length < wanted) {
        const index = cursor++;
        try {
          const value = await mapper(items[index]);
          if (value !== null) output.push(value);
        } catch {
          /* An invalid Archive candidate is omitted, not fabricated. */
        }
      }
    }),
  );
  return output.slice(0, wanted === Number.POSITIVE_INFINITY ? undefined : wanted);
}

function boundedLimit(
  searchParams: URLSearchParams,
  defaultValue: number,
  maximum: number,
  clamp = false,
): NextResponse | string {
  const raw = searchParams.get('limit');
  if (raw === null) return String(defaultValue);
  if (!/^\d+$/.test(raw)) return NextResponse.json({ error: 'Invalid limit' }, { status: 400 });

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    return NextResponse.json({ error: 'Invalid limit' }, { status: 400 });
  }
  if (value > maximum && !clamp) {
    return NextResponse.json({ error: `Limit must not exceed ${maximum}` }, { status: 400 });
  }
  return String(Math.min(value, maximum));
}

function jamendoUrl(endpoint: string, params: URLSearchParams): string {
  const url = new URL(`${JAMENDO_API}${endpoint}`);
  params.forEach((value, key) => url.searchParams.set(key, value));
  // Credentials and response format are server-controlled and cannot be
  // overridden by incoming query parameters.
  url.searchParams.set('client_id', process.env.JAMENDO_CLIENT_ID ?? '');
  url.searchParams.set('format', 'json');
  return url.toString();
}

/**
 * Media hosts, per provider, measured rather than assumed.
 *
 * Checked directly against each upstream: Jamendo and Apple answer the stream
 * URL with a 200 and no redirect at all, while Archive answers 302 with a
 * per-node `dn######.<region>.archive.org` host — which is why that one is a
 * domain suffix and the others are not.
 *
 * Every entry is a *ceiling*, not a promise that a redirect will happen. The
 * jamendo, archive and itunes paths used to pass no validator at all, which
 * meant fetch followed whatever `Location` arrived: an upstream that could be
 * induced to emit one turned this route into a way to fetch an arbitrary URL
 * and stream the response back through our own origin.
 */
const MEDIA_HOSTS: Record<'jamendo' | 'ccmixter' | 'archive' | 'itunes', ApprovedMediaHost> = {
  jamendo: mediaHostAllowlist(['mp3l.jamendo.com'], ['.jamendo.com']),
  ccmixter: mediaHostAllowlist([...CCMIXTER_MEDIA_HOSTS]),
  archive: mediaHostAllowlist(['archive.org'], ['.archive.org']),
  itunes: mediaHostAllowlist([ITUNES_PREVIEW_HOST]),
};

async function proxyStream(
  request: NextRequest,
  streamUrl: string,
  isApproved: ApprovedMediaHost,
  upstreamHeaders?: Record<string, string>,
): Promise<NextResponse> {
  const requestHeaders = new Headers();
  const range = request.headers.get('range');
  const ifRange = request.headers.get('if-range');
  if (range) requestHeaders.set('range', range);
  if (ifRange) requestHeaders.set('if-range', ifRange);
  // Some providers reject media requests that omit the headers their own site
  // sends. These are set by the route, never forwarded from the browser.
  for (const [name, value] of Object.entries(upstreamHeaders ?? {})) {
    requestHeaders.set(name, value);
  }

  try {
    const fetched = await fetchApprovedMedia(request, streamUrl, {
      isApproved,
      headers: requestHeaders,
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxRedirects: MAX_STREAM_REDIRECTS,
    });
    if (!fetched.ok) return fetched.response;
    const { response: upstream, controller, cleanup } = fetched;

    if (upstream.ok) {
      const contentType = upstream.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
      if (!contentType || (contentType !== 'application/octet-stream' && !contentType.startsWith('audio/'))) {
        closeUpstream(upstream, cleanup);
        return NextResponse.json({ error: 'Upstream returned invalid media' }, { status: 502 });
      }
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
    if (range || upstream.status === 206) {
      headers.set('Cache-Control', 'private, no-store');
    } else if (upstream.ok) {
      setCdnCacheHeaders(headers, FULL_STREAM_CACHE_CONTROL);
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

async function handleJamendo(req: NextRequest, resource: string | undefined, rest: string[]): Promise<NextResponse> {
  if (!process.env.JAMENDO_CLIENT_ID) {
    return NextResponse.json({ error: 'Jamendo client_id not configured' }, { status: 503 });
  }

  if (resource === 'stream') {
    const trackId = numericId(rest[0], 'track ID');
    if (trackId instanceof NextResponse) return trackId;
    if (rest.length !== 1) return NextResponse.json({ error: 'Invalid track ID' }, { status: 400 });
    return proxyStream(req, `https://mp3l.jamendo.com/?trackid=${trackId}&format=mp31`, MEDIA_HOSTS.jamendo);
  }

  const endpointMap: Record<string, string> = { tracks: '/tracks', albums: '/albums', artists: '/artists' };
  const mapped = resource ? endpointMap[resource] : undefined;
  if (!mapped) return NextResponse.json({ error: `Unknown endpoint: ${resource ?? ''}` }, { status: 400 });

  const searchParams = new URLSearchParams(req.nextUrl.searchParams);
  searchParams.delete('path');
  const limit = boundedLimit(searchParams, 50, 200);
  if (limit instanceof NextResponse) return limit;
  searchParams.set('limit', limit);

  try {
    const upstream = await upstreamFetch(req, jamendoUrl(mapped, searchParams));
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Jamendo upstream error' }, { status: upstream.status });
    }
    const data = (await upstream.json()) as {
      headers?: { status?: string; error_message?: string; next?: string };
    };
    if (data.headers?.status === 'failed') {
      return NextResponse.json({ error: data.headers.error_message || 'Jamendo API error' }, { status: 502 });
    }
    if (data.headers) delete data.headers.next;
    return catalogResponse(data);
  } catch (error) {
    return providerFailure(error, 'Jamendo fetch failed');
  }
}

async function handleCCMixter(req: NextRequest, resource: string | undefined, rest: string[]): Promise<NextResponse> {
  if (resource === 'stream') {
    const uploadId = numericId(rest[0], 'upload ID');
    if (uploadId instanceof NextResponse) return uploadId;
    if (rest.length !== 1) return NextResponse.json({ error: 'Invalid upload ID' }, { status: 400 });

    try {
      const metadata = await upstreamFetch(
        req,
        `https://ccmixter.org/api/query?upload_id=${uploadId}&format=json&f=json`,
      );
      if (!metadata.ok) return new NextResponse('Stream metadata unavailable', { status: metadata.status });
      const tracks = (await metadata.json()) as Array<{
        files?: Array<{ download_url?: string; file_format_info?: { mime_type?: string } }>;
      }>;
      const mp3File = tracks[0]?.files?.find(
        (file) => file.file_format_info?.mime_type === 'audio/mpeg' && Boolean(file.download_url),
      );
      const downloadUrl = mp3File?.download_url;
      if (!downloadUrl) return new NextResponse('Stream unavailable', { status: 404 });

      const parsedUrl = validMediaUrl(downloadUrl);
      if (!parsedUrl) {
        return new NextResponse('Stream unavailable', { status: 502 });
      }
      return proxyStream(req, parsedUrl.toString(), MEDIA_HOSTS.ccmixter, CCMIXTER_MEDIA_HEADERS);
    } catch (error) {
      return providerFailure(error, 'ccMixter stream fetch failed');
    }
  }

  if (resource === 'tracks') {
    const searchParams = new URLSearchParams(req.nextUrl.searchParams);
    searchParams.delete('path');
    searchParams.set('format', 'json');
    searchParams.set('f', 'json');
    const limit = boundedLimit(searchParams, CCMIXTER_PAGE_SIZE, CCMIXTER_MAX_RECORDS, true);
    if (limit instanceof NextResponse) return limit;

    const degraded = (reason: string) =>
      NextResponse.json(
        { results: [], degraded: true, provider: 'ccMixter', reason },
        { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
      );

    const wanted = Number(limit);
    const results: unknown[] = [];
    // Record size varies with each upload's description, so no fixed page size
    // is universally safe. A page that overflows is retried smaller, and the
    // records already collected are always preserved.
    let pageSize = CCMIXTER_PAGE_SIZE;
    let offset = 0;

    const settle = (reason: string) => (results.length > 0 ? catalogResponse({ results }) : degraded(reason));

    while (results.length < wanted) {
      const requested = Math.min(pageSize, wanted - results.length);
      const pageParams = new URLSearchParams(searchParams);
      pageParams.set('limit', String(requested));
      pageParams.set('offset', String(offset));

      let page: unknown[];
      try {
        const upstream = await upstreamFetch(req, `https://ccmixter.org/api/query?${pageParams.toString()}`);
        if (!upstream.ok) return settle('upstream-unavailable');

        const text = await upstream.text();
        if (!text.trim()) {
          if (pageSize === 1) return settle('upstream-empty-response');
          pageSize = Math.max(1, Math.floor(pageSize / 2));
          continue;
        }

        const parsed: unknown = JSON.parse(text);
        if (!Array.isArray(parsed)) return settle('upstream-invalid-json');
        page = parsed;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return providerFailure(error, 'ccMixter fetch failed');
        }
        // An oversized X-JSON header aborts the response before its body is
        // readable. A smaller page keeps the same request viable.
        if (pageSize === 1) return settle('upstream-unavailable');
        pageSize = Math.max(1, Math.floor(pageSize / 2));
        continue;
      }

      results.push(...page);
      // A short page means the upstream has no more records to give.
      if (page.length < requested) break;
      offset += page.length;
    }

    return catalogResponse({ results });
  }

  return NextResponse.json({ error: `Unknown ccMixter endpoint: ${resource ?? ''}` }, { status: 400 });
}

async function handleArchive(req: NextRequest, resource: string | undefined, rest: string[]): Promise<NextResponse> {
  if (resource === 'stream') {
    const identifier = archiveId(rest[0]);
    if (identifier instanceof NextResponse) return identifier;
    if (rest.length !== 1) return NextResponse.json({ error: 'Invalid identifier' }, { status: 400 });

    try {
      const metadata = await upstreamFetch(req, `https://archive.org/metadata/${encodeURIComponent(identifier)}`);
      if (!metadata.ok) return new NextResponse('Stream metadata unavailable', { status: metadata.status });
      const data = (await metadata.json()) as { files?: ArchiveFile[] };
      const requestedFile = req.nextUrl.searchParams.get('file');
      const mp3 = requestedFile
        ? data.files?.find(
            (file): file is ArchiveFile & { name: string } => file.name === requestedFile && playableArchiveFile(file),
          ) || null
        : chooseArchiveFile(data.files);
      if (!mp3) return new NextResponse('Stream unavailable', { status: 404 });

      const downloadUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${mp3.name.split('/').map(encodeURIComponent).join('/')}`;
      return proxyStream(req, downloadUrl, MEDIA_HOSTS.archive);
    } catch (error) {
      return providerFailure(error, 'Archive stream fetch failed');
    }
  }

  if (resource === 'tracks') {
    const exactIdentifier = req.nextUrl.searchParams.get('identifier');
    const exactFilename = req.nextUrl.searchParams.get('filename');
    if (exactIdentifier || exactFilename) {
      if (
        !exactIdentifier ||
        !ARCHIVE_ID.test(exactIdentifier) ||
        !exactFilename ||
        exactFilename.length > 500 ||
        !safeArchiveFilename(exactFilename)
      ) {
        return NextResponse.json({ error: 'Invalid exact Archive file identity' }, { status: 400 });
      }
      try {
        const metadataResponse = await upstreamFetch(
          req,
          `https://archive.org/metadata/${encodeURIComponent(exactIdentifier)}`,
        );
        if (!metadataResponse.ok) return NextResponse.json({ results: [] }, { status: 200 });
        const item = (await metadataResponse.json()) as { metadata?: Record<string, unknown>; files?: ArchiveFile[] };
        const metadata = item.metadata || {};
        const license = archiveLicense(metadata.licenseurl);
        const file = item.files?.find(
          (candidate) => candidate.name === exactFilename && playableArchiveFile(candidate),
        );
        const title = scalar(metadata.title);
        const creatorName = scalar(metadata.creator);
        const subjects = (Array.isArray(metadata.subject) ? metadata.subject : [metadata.subject])
          .map(scalar)
          .filter(Boolean);
        const duration = parseDuration(file?.length);
        const size = Number(file?.size || 0);
        if (
          !license ||
          !file ||
          !title ||
          !creatorName ||
          NON_MUSIC_ARCHIVE_TERMS.test([title, creatorName, ...subjects].join(' ')) ||
          duration <= 0 ||
          !Number.isFinite(size) ||
          size <= 0
        ) {
          return NextResponse.json({ results: [] }, { status: 200 });
        }
        const playableFilename = file.name as string;
        return catalogResponse({
          results: [
            {
              identifier: exactIdentifier,
              title,
              creator: creatorName,
              subject: subjects,
              year: scalar(metadata.year),
              filename: playableFilename,
              duration,
              size,
              bitRate: Number(file.bitrate || 0),
              contentType: 'audio/mpeg',
              suffix: 'mp3',
              streamUrl: `/api/music/archive/stream/${encodeURIComponent(exactIdentifier)}?file=${encodeURIComponent(playableFilename)}`,
              sourceUrl: `https://archive.org/details/${encodeURIComponent(exactIdentifier)}`,
              creatorUrl: '',
              licenseName: license.name,
              licenseUrl: license.url,
              attributionUrl: `https://archive.org/details/${encodeURIComponent(exactIdentifier)}`,
            },
          ],
        });
      } catch (error) {
        return providerFailure(error, 'Archive exact track fetch failed');
      }
    }

    const subject = req.nextUrl.searchParams.get('subject');
    const creator = req.nextUrl.searchParams.get('creator');
    if (subject && creator) return NextResponse.json({ error: 'Choose subject or creator' }, { status: 400 });
    const filterValue = creator || subject || 'classical';
    if (filterValue.length > 100) return NextResponse.json({ error: 'Invalid catalog filter' }, { status: 400 });
    const limit = boundedLimit(req.nextUrl.searchParams, 50, 100);
    if (limit instanceof NextResponse) return limit;
    const field = creator ? 'creator' : 'subject';
    const query = `mediatype:audio AND format:MP3 AND licenseurl:*creativecommons* AND ${field}:(${filterValue})`;
    const candidateRows = Math.min(Number(limit) * 3, 100);
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=subject&fl[]=year&fl[]=licenseurl&output=json&rows=${candidateRows}&sort[]=downloads+desc`;

    try {
      const upstream = await upstreamFetch(req, url);
      if (!upstream.ok) {
        return NextResponse.json({ error: 'Archive upstream error' }, { status: upstream.status });
      }
      const data = (await upstream.json()) as { response?: { docs?: Array<Record<string, unknown>> } };
      const candidates = Array.isArray(data.response?.docs) ? data.response.docs : [];
      const results = await mapConcurrent(
        candidates,
        ARCHIVE_ENRICHMENT_CONCURRENCY,
        async (doc) => {
          const identifier = scalar(doc.identifier);
          const searchLicense = archiveLicense(doc.licenseurl);
          if (!identifier || !ARCHIVE_ID.test(identifier) || !searchLicense) return null;
          const metadataResponse = await upstreamFetch(
            req,
            `https://archive.org/metadata/${encodeURIComponent(identifier)}`,
          );
          if (!metadataResponse.ok) return null;
          const item = (await metadataResponse.json()) as { metadata?: Record<string, unknown>; files?: ArchiveFile[] };
          const metadata = item.metadata || {};
          const license = archiveLicense(metadata.licenseurl) || searchLicense;
          const file = chooseArchiveFile(item.files);
          const title = scalar(metadata.title) || scalar(doc.title);
          const creatorName = scalar(metadata.creator) || scalar(doc.creator);
          const subjects = [
            ...(Array.isArray(metadata.subject) ? metadata.subject : [metadata.subject]),
            ...(Array.isArray(doc.subject) ? doc.subject : [doc.subject]),
          ]
            .map(scalar)
            .filter(Boolean);
          const classifierText = [title, creatorName, ...subjects, scalar(metadata.collection)].join(' ');
          if (!license || !file || !title || !creatorName || NON_MUSIC_ARCHIVE_TERMS.test(classifierText)) return null;
          const duration = parseDuration(file.length);
          const size = Number(file.size || 0);
          if (duration <= 0 || !Number.isFinite(size) || size <= 0) return null;
          return {
            identifier,
            title,
            creator: creatorName,
            subject: subjects,
            year: scalar(metadata.year) || scalar(doc.year),
            filename: file.name,
            duration,
            size,
            bitRate: Number(file.bitrate || 0),
            contentType: 'audio/mpeg',
            suffix: 'mp3',
            streamUrl: `/api/music/archive/stream/${encodeURIComponent(identifier)}?file=${encodeURIComponent(file.name)}`,
            sourceUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
            creatorUrl: '',
            licenseName: license.name,
            licenseUrl: license.url,
            attributionUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
          };
        },
        Number(limit),
      );
      return catalogResponse({ results });
    } catch (error) {
      return providerFailure(error, 'Archive fetch failed');
    }
  }

  return NextResponse.json({ error: `Unknown archive endpoint: ${resource ?? ''}` }, { status: 400 });
}

function itunesCountry(searchParams: URLSearchParams): NextResponse | string {
  const raw = (searchParams.get('country') || 'us').toLowerCase();
  if (!ITUNES_COUNTRY.test(raw)) return NextResponse.json({ error: 'Invalid country' }, { status: 400 });
  return raw;
}

function itunesEntity(searchParams: URLSearchParams): NextResponse | string {
  const raw = searchParams.get('entity') || 'song';
  if (!ITUNES_ENTITIES.has(raw)) return NextResponse.json({ error: 'Invalid entity' }, { status: 400 });
  return raw;
}

/**
 * Resolves an iTunes track id to its preview URL.
 *
 * The stream route takes a track id rather than a preview URL so nothing
 * client-supplied is ever fetched: the URL is read back from Apple's own lookup
 * response and host-checked before a byte is proxied. That costs one extra
 * upstream request per stream, which the CDN cache absorbs.
 */
async function itunesPreviewUrl(req: NextRequest, trackId: string, country: string): Promise<string | null> {
  const lookup = await upstreamFetch(req, `${ITUNES_API}/lookup?id=${trackId}&entity=song&country=${country}`);
  if (!lookup.ok) return null;
  const data = (await lookup.json()) as { results?: Array<{ trackId?: number; previewUrl?: string }> };
  const preview = data.results?.find((item) => String(item.trackId) === trackId)?.previewUrl;
  if (typeof preview !== 'string') return null;
  try {
    const url = new URL(preview);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    return url.hostname.toLowerCase() === ITUNES_PREVIEW_HOST ? url.toString() : null;
  } catch {
    return null;
  }
}

async function handleItunes(req: NextRequest, resource: string | undefined, rest: string[]): Promise<NextResponse> {
  const searchParams = new URLSearchParams(req.nextUrl.searchParams);
  searchParams.delete('path');
  const country = itunesCountry(searchParams);
  if (country instanceof NextResponse) return country;

  if (resource === 'stream') {
    const trackId = numericId(rest[0], 'track ID');
    if (trackId instanceof NextResponse) return trackId;
    if (rest.length !== 1) return NextResponse.json({ error: 'Invalid track ID' }, { status: 400 });
    try {
      const preview = await itunesPreviewUrl(req, trackId, country);
      if (!preview) return new NextResponse('Preview unavailable', { status: 404 });
      return proxyStream(req, preview, MEDIA_HOSTS.itunes);
    } catch (error) {
      return providerFailure(error, 'Apple preview fetch failed');
    }
  }

  if (resource !== 'search' && resource !== 'lookup') {
    return NextResponse.json({ error: `Unknown Apple endpoint: ${resource ?? ''}` }, { status: 400 });
  }

  const entity = itunesEntity(searchParams);
  if (entity instanceof NextResponse) return entity;
  const limit = boundedLimit(searchParams, 25, 200);
  if (limit instanceof NextResponse) return limit;

  const url = new URL(`${ITUNES_API}/${resource}`);
  url.searchParams.set('entity', entity);
  url.searchParams.set('limit', limit);
  url.searchParams.set('country', country);
  url.searchParams.set('media', 'music');

  if (resource === 'search') {
    const term = searchParams.get('term')?.trim();
    if (!term || term.length > 200) return NextResponse.json({ error: 'Invalid term' }, { status: 400 });
    url.searchParams.set('term', term);
  } else {
    const ids = (searchParams.get('id') || '').split(',').map((value) => value.trim());
    if (ids.length > ITUNES_MAX_LOOKUP_IDS || !ids.every((value) => NUMERIC_ID.test(value))) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    url.searchParams.set('id', ids.join(','));
  }

  try {
    const upstream = await upstreamFetch(req, url.toString());
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Apple upstream error' }, { status: upstream.status });
    }
    const data = (await upstream.json()) as { results?: unknown[] };
    return catalogResponse({ results: Array.isArray(data.results) ? data.results : [] });
  } catch (error) {
    return providerFailure(error, 'Apple fetch failed');
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const pathSegments = (await params).path || [];
  const [provider, resource, ...rest] = pathSegments;
  const { bucket } = classifyRoute(provider, resource);
  const limited = rateLimit(req, bucket);
  if (limited) return limited;

  switch (provider) {
    case 'jamendo':
      return handleJamendo(req, resource, rest);
    case 'ccmixter':
      return handleCCMixter(req, resource, rest);
    case 'archive':
      return handleArchive(req, resource, rest);
    case 'itunes':
      return handleItunes(req, resource, rest);
    default:
      return NextResponse.json({ error: `Unknown provider: ${provider ?? ''}` }, { status: 400 });
  }
}
