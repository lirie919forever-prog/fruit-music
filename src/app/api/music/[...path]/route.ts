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
import { normalizeCreativeCommonsLicense } from '@/lib/licenses';

const JAMENDO_API = 'https://api.jamendo.com/v3.0';
const ITUNES_API = 'https://itunes.apple.com';
const DEEZER_API = 'https://api.deezer.com';
const AUDIUS_API = 'https://api.audius.co/v1';
const OPENVERSE_API = 'https://api.openverse.org/v1/audio';
const WIKIMEDIA_COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const SOMAFM_API = 'https://somafm.com';
const SOMAFM_STREAM_API = 'https://api.somafm.com';
// The DNS-balanced endpoint intermittently returns 503 from Vercel's network.
// Start with a direct, healthy mirror and retain the global endpoint as a
// fallback so one Radio Browser node cannot empty the live-radio shelf.
const RADIO_BROWSER_APIS = [
  'https://de1.api.radio-browser.info/json',
  'https://all.api.radio-browser.info/json',
] as const;
// Every preview sampled across five unrelated searches came from this single
// host, so the allowlist is a host rather than a suffix match. A preview served
// from anywhere else is treated as unavailable rather than proxied blind.
const ITUNES_PREVIEW_HOST = 'audio-ssl.itunes.apple.com';
const ITUNES_ENTITIES = new Set(['song', 'album', 'musicArtist']);
const ITUNES_COUNTRY = /^[a-z]{2}$/;
const ITUNES_MAX_LOOKUP_IDS = 50;
const REQUEST_TIMEOUT_MS = 15_000;
const NUMERIC_ID = /^[1-9]\d{0,15}$/;
const AUDIUS_ID = /^[A-Za-z0-9_-]{1,128}$/;
const OPENVERSE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARCHIVE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SOMAFM_ID = /^[a-z0-9-]{1,64}$/;
const RADIO_STATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CCMIXTER_MEDIA_HOSTS = new Set(['ccmixter.org', 'www.ccmixter.org']);
const ARCHIVE_ENRICHMENT_CONCURRENCY = 4;
const NON_MUSIC_ARCHIVE_TERMS =
  /\b(audiobook|audio book|librivox|podcast|spoken word|radio (talk|conversation)|lecture|sermon|philosophy|literature|novel|poetry reading)\b/i;
const CATALOG_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';
const FULL_STREAM_CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=604800';
const MAX_STREAM_REDIRECTS = 3;
const OPENVERSE_USER_AGENT = 'Marea music catalog/1.0 (+https://github.com/)';
const WIKIMEDIA_USER_AGENT = 'Marea music catalog/1.0 (+https://github.com/)';
const RADIO_BROWSER_USER_AGENT = 'Marea music catalog/1.0 (+https://github.com/)';
const WIKIMEDIA_UPLOAD_HOST = 'upload.wikimedia.org';
const MIN_FULL_TRACK_DURATION_SECONDS = 60;
const MUSIC_STATION_TERMS =
  /\b(music|radio|fm|vinyl|pop|rock|jazz|classical|dance|electronic|rnb|hip[ -]?hop|country|oldies|soul|reggae|metal|indie|alternative|hits|top ?40|ambient|house|trance|latin|folk|blues|disco|k-?pop|j-?pop)\b/i;
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
  // Catalog providers use either `{ results }` or `{ data }` envelopes.
  const results = (data as { results?: unknown; data?: unknown }).results ?? (data as { data?: unknown }).data;
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

function opaqueId(value: string | undefined, label: string): NextResponse | string {
  if (!value) return NextResponse.json({ error: `Missing ${label}` }, { status: 400 });
  if (!AUDIUS_ID.test(value)) return NextResponse.json({ error: `Invalid ${label}` }, { status: 400 });
  return value;
}

function openverseId(value: string | undefined): NextResponse | string {
  if (!value) return NextResponse.json({ error: 'Missing audio ID' }, { status: 400 });
  if (!OPENVERSE_ID.test(value)) return NextResponse.json({ error: 'Invalid audio ID' }, { status: 400 });
  return value;
}

function queryValue(searchParams: URLSearchParams, key: string, label: string, maxLength = 200): NextResponse | string {
  const value = searchParams.get(key)?.trim();
  if (!value || value.length > maxLength) return NextResponse.json({ error: `Invalid ${label}` }, { status: 400 });
  return value;
}

function archiveId(value: string | undefined): NextResponse | string {
  if (!value) return NextResponse.json({ error: 'Missing identifier' }, { status: 400 });
  if (!ARCHIVE_ID.test(value)) return NextResponse.json({ error: 'Invalid identifier' }, { status: 400 });
  return value;
}

function somaFmId(value: string | undefined): NextResponse | string {
  if (!value) return NextResponse.json({ error: 'Missing SomaFM station ID' }, { status: 400 });
  if (!SOMAFM_ID.test(value)) return NextResponse.json({ error: 'Invalid SomaFM station ID' }, { status: 400 });
  return value;
}

function radioStationId(value: string | undefined): NextResponse | string {
  if (!value) return NextResponse.json({ error: 'Missing radio station ID' }, { status: 400 });
  if (!RADIO_STATION_ID.test(value)) return NextResponse.json({ error: 'Invalid radio station ID' }, { status: 400 });
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
const MEDIA_HOSTS: Record<
  'jamendo' | 'ccmixter' | 'archive' | 'itunes' | 'deezer' | 'wikimedia' | 'somafm',
  ApprovedMediaHost
> = {
  jamendo: mediaHostAllowlist(['mp3l.jamendo.com'], ['.jamendo.com']),
  ccmixter: mediaHostAllowlist([...CCMIXTER_MEDIA_HOSTS]),
  archive: mediaHostAllowlist(['archive.org'], ['.archive.org']),
  itunes: mediaHostAllowlist([ITUNES_PREVIEW_HOST]),
  deezer: mediaHostAllowlist([], ['.dzcdn.net']),
  wikimedia: mediaHostAllowlist([WIKIMEDIA_UPLOAD_HOST]),
  somafm: mediaHostAllowlist([], ['.somafm.com']),
};

async function proxyStream(
  request: NextRequest,
  streamUrl: string,
  isApproved: ApprovedMediaHost,
  upstreamHeaders?: Record<string, string>,
  live = false,
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
      if (
        !contentType ||
        (contentType !== 'application/octet-stream' &&
          contentType !== 'application/ogg' &&
          !contentType.startsWith('audio/'))
      ) {
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
    if (live || range || upstream.status === 206) {
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

function hasUpstreamError(data: unknown): boolean {
  return typeof data === 'object' && data !== null && 'error' in data && Boolean((data as { error?: unknown }).error);
}

function selectorCount(values: Array<string | null>): number {
  return values.filter((value) => value !== null).length;
}

async function handleDeezer(req: NextRequest, resource: string | undefined, rest: string[]): Promise<NextResponse> {
  if (resource === 'stream') {
    const trackId = numericId(rest[0], 'track ID');
    if (trackId instanceof NextResponse) return trackId;
    if (rest.length !== 1) return NextResponse.json({ error: 'Invalid track ID' }, { status: 400 });
    try {
      const upstream = await upstreamFetch(req, `${DEEZER_API}/track/${trackId}`);
      if (!upstream.ok) return new NextResponse('Preview unavailable', { status: upstream.status });
      const track = (await upstream.json()) as { preview?: unknown; error?: unknown };
      if (track.error || typeof track.preview !== 'string')
        return new NextResponse('Preview unavailable', { status: 404 });
      return proxyStream(req, track.preview, MEDIA_HOSTS.deezer);
    } catch (error) {
      return providerFailure(error, 'Deezer preview fetch failed');
    }
  }

  if (rest.length > 0) return NextResponse.json({ error: 'Invalid Deezer path' }, { status: 400 });
  if (resource !== 'tracks' && resource !== 'albums' && resource !== 'artists') {
    return NextResponse.json({ error: `Unknown Deezer endpoint: ${resource ?? ''}` }, { status: 400 });
  }

  const searchParams = req.nextUrl.searchParams;
  const limit = boundedLimit(searchParams, 30, 100);
  if (limit instanceof NextResponse) return limit;
  const id = searchParams.get('id');
  const albumId = searchParams.get('album_id');
  const artistId = searchParams.get('artist_id');
  const query = searchParams.get('q');
  const chart = searchParams.get('chart');
  let endpoint = '';
  let single = false;

  if (resource === 'tracks') {
    if (selectorCount([id, albumId, artistId, query, chart]) !== 1) {
      return NextResponse.json({ error: 'Choose one Deezer track selector' }, { status: 400 });
    }
    if (id !== null) {
      const valid = numericId(id, 'track ID');
      if (valid instanceof NextResponse) return valid;
      endpoint = `/track/${valid}`;
      single = true;
    } else if (albumId !== null) {
      const valid = numericId(albumId, 'album ID');
      if (valid instanceof NextResponse) return valid;
      endpoint = `/album/${valid}/tracks`;
    } else if (artistId !== null) {
      const valid = numericId(artistId, 'artist ID');
      if (valid instanceof NextResponse) return valid;
      endpoint = `/artist/${valid}/top`;
    } else if (chart !== null) {
      if (chart !== '1') return NextResponse.json({ error: 'Invalid chart selector' }, { status: 400 });
      endpoint = '/chart/0/tracks';
    } else {
      const valid = queryValue(searchParams, 'q', 'query');
      if (valid instanceof NextResponse) return valid;
      endpoint = `/search?q=${encodeURIComponent(valid)}`;
    }
  } else if (resource === 'albums') {
    if (selectorCount([id, artistId, query]) !== 1) {
      return NextResponse.json({ error: 'Choose one Deezer album selector' }, { status: 400 });
    }
    if (id !== null) {
      const valid = numericId(id, 'album ID');
      if (valid instanceof NextResponse) return valid;
      endpoint = `/album/${valid}`;
      single = true;
    } else if (artistId !== null) {
      const valid = numericId(artistId, 'artist ID');
      if (valid instanceof NextResponse) return valid;
      endpoint = `/artist/${valid}/albums`;
    } else {
      const valid = queryValue(searchParams, 'q', 'query');
      if (valid instanceof NextResponse) return valid;
      endpoint = `/search/album?q=${encodeURIComponent(valid)}`;
    }
  } else {
    if (selectorCount([id, query]) !== 1) {
      return NextResponse.json({ error: 'Choose one Deezer artist selector' }, { status: 400 });
    }
    if (id !== null) {
      const valid = numericId(id, 'artist ID');
      if (valid instanceof NextResponse) return valid;
      endpoint = `/artist/${valid}`;
      single = true;
    } else {
      const valid = queryValue(searchParams, 'q', 'query');
      if (valid instanceof NextResponse) return valid;
      endpoint = `/search/artist?q=${encodeURIComponent(valid)}`;
    }
  }

  try {
    const url = new URL(`${DEEZER_API}${endpoint}`);
    if (!single) url.searchParams.set('limit', limit);
    const upstream = await upstreamFetch(req, url.toString());
    if (!upstream.ok) return NextResponse.json({ error: 'Deezer upstream error' }, { status: upstream.status });
    const payload = (await upstream.json()) as { data?: unknown[]; error?: unknown };
    if (hasUpstreamError(payload)) return NextResponse.json({ error: 'Deezer upstream error' }, { status: 502 });
    return catalogResponse({ data: single ? [payload] : Array.isArray(payload.data) ? payload.data : [] });
  } catch (error) {
    return providerFailure(error, 'Deezer fetch failed');
  }
}

function audiusRecords(payload: unknown): unknown[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { data?: unknown }).data;
  return Array.isArray(data) ? data : data === undefined || data === null ? [] : [data];
}

function isAudiusAlbumRecord(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { is_album?: unknown }).is_album === true;
}

async function handleAudius(req: NextRequest, resource: string | undefined, rest: string[]): Promise<NextResponse> {
  if (rest.length > 0) return NextResponse.json({ error: 'Invalid Audius path' }, { status: 400 });
  if (resource !== 'tracks' && resource !== 'albums' && resource !== 'artists') {
    return NextResponse.json({ error: `Unknown Audius endpoint: ${resource ?? ''}` }, { status: 400 });
  }

  const searchParams = req.nextUrl.searchParams;
  const limit = boundedLimit(searchParams, 30, 100);
  if (limit instanceof NextResponse) return limit;
  const id = searchParams.get('id');
  const artistId = searchParams.get('artist_id');
  const albumId = searchParams.get('album_id');
  const query = searchParams.get('q');
  const trending = searchParams.get('trending');
  let endpoint = '';

  if (resource === 'tracks') {
    if (selectorCount([id, artistId, albumId, query, trending]) !== 1) {
      return NextResponse.json({ error: 'Choose one Audius track selector' }, { status: 400 });
    }
    if (id !== null) {
      const valid = opaqueId(id, 'track ID');
      if (valid instanceof NextResponse) return valid;
      endpoint = `/tracks/${encodeURIComponent(valid)}`;
    } else if (artistId !== null) {
      const valid = opaqueId(artistId, 'artist ID');
      if (valid instanceof NextResponse) return valid;
      endpoint = `/users/${encodeURIComponent(valid)}/tracks`;
    } else if (albumId !== null) {
      const valid = opaqueId(albumId, 'album ID');
      if (valid instanceof NextResponse) return valid;
      endpoint = `/playlists/${encodeURIComponent(valid)}/tracks`;
    } else if (trending !== null) {
      if (trending !== '1') return NextResponse.json({ error: 'Invalid trending selector' }, { status: 400 });
      endpoint = '/tracks/trending';
    } else {
      const valid = queryValue(searchParams, 'q', 'query');
      if (valid instanceof NextResponse) return valid;
      endpoint = '/tracks/search';
      searchParams.set('query', valid);
    }
  } else if (resource === 'albums') {
    if (selectorCount([id, artistId, query, trending]) !== 1) {
      return NextResponse.json({ error: 'Choose one Audius album selector' }, { status: 400 });
    }
    if (id !== null) {
      const valid = opaqueId(id, 'album ID');
      if (valid instanceof NextResponse) return valid;
      endpoint = `/playlists/${encodeURIComponent(valid)}`;
    } else if (artistId !== null) {
      const valid = opaqueId(artistId, 'artist ID');
      if (valid instanceof NextResponse) return valid;
      endpoint = `/users/${encodeURIComponent(valid)}/albums`;
    } else if (trending !== null) {
      if (trending !== '1') return NextResponse.json({ error: 'Invalid trending selector' }, { status: 400 });
      endpoint = '/playlists/trending';
    } else {
      const valid = queryValue(searchParams, 'q', 'query');
      if (valid instanceof NextResponse) return valid;
      endpoint = '/playlists/search';
      searchParams.set('query', valid);
    }
  } else {
    if (selectorCount([id, query]) !== 1) {
      return NextResponse.json({ error: 'Choose one Audius artist selector' }, { status: 400 });
    }
    if (id !== null) {
      const valid = opaqueId(id, 'artist ID');
      if (valid instanceof NextResponse) return valid;
      endpoint = `/users/${encodeURIComponent(valid)}`;
    } else {
      const valid = queryValue(searchParams, 'q', 'query');
      if (valid instanceof NextResponse) return valid;
      endpoint = '/users/search';
      searchParams.set('query', valid);
    }
  }

  try {
    const url = new URL(`${AUDIUS_API}${endpoint}`);
    url.searchParams.set('app_name', 'marea');
    url.searchParams.set('limit', limit);
    if (searchParams.has('query')) url.searchParams.set('query', searchParams.get('query')!);
    const upstream = await upstreamFetch(req, url.toString());
    if (!upstream.ok) return NextResponse.json({ error: 'Audius upstream error' }, { status: upstream.status });
    const payload: unknown = await upstream.json();
    if (hasUpstreamError(payload)) return NextResponse.json({ error: 'Audius upstream error' }, { status: 502 });
    const records = audiusRecords(payload);
    return catalogResponse({ data: resource === 'albums' ? records.filter(isAudiusAlbumRecord) : records });
  } catch (error) {
    return providerFailure(error, 'Audius fetch failed');
  }
}

async function handleOpenverse(req: NextRequest, resource: string | undefined, rest: string[]): Promise<NextResponse> {
  if (resource !== 'tracks' || rest.length > 0) {
    return NextResponse.json({ error: `Unknown Openverse endpoint: ${resource ?? ''}` }, { status: 400 });
  }

  const searchParams = req.nextUrl.searchParams;
  const id = searchParams.get('id');
  const query = searchParams.get('q');
  const creator = searchParams.get('creator');
  if (selectorCount([id, query, creator]) !== 1) {
    return NextResponse.json({ error: 'Choose one Openverse audio selector' }, { status: 400 });
  }
  const limit = boundedLimit(searchParams, 12, 20);
  if (limit instanceof NextResponse) return limit;

  try {
    let url: URL;
    if (id !== null) {
      const valid = openverseId(id);
      if (valid instanceof NextResponse) return valid;
      url = new URL(`${OPENVERSE_API}/${encodeURIComponent(valid)}/`);
    } else {
      url = new URL(`${OPENVERSE_API}/`);
      if (query !== null) {
        const valid = queryValue(searchParams, 'q', 'query');
        if (valid instanceof NextResponse) return valid;
        url.searchParams.set('q', valid);
      } else {
        const valid = queryValue(searchParams, 'creator', 'creator');
        if (valid instanceof NextResponse) return valid;
        url.searchParams.set('creator', valid);
      }
      url.searchParams.set('page_size', limit);
      url.searchParams.set('mature', 'false');
    }
    const upstream = await upstreamFetch(req, url.toString(), { headers: { 'user-agent': OPENVERSE_USER_AGENT } });
    if (!upstream.ok) return NextResponse.json({ error: 'Openverse upstream error' }, { status: upstream.status });
    const payload: unknown = await upstream.json();
    if (hasUpstreamError(payload)) return NextResponse.json({ error: 'Openverse upstream error' }, { status: 502 });
    const records = Array.isArray((payload as { results?: unknown }).results)
      ? ((payload as { results: unknown[] }).results ?? [])
      : [payload];
    return catalogResponse({
      results: records.filter(
        (record) => typeof record === 'object' && record !== null && (record as { mature?: unknown }).mature !== true,
      ),
    });
  } catch (error) {
    return providerFailure(error, 'Openverse fetch failed');
  }
}

interface SomaFmChannel {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  genre?: unknown;
  lastPlaying?: unknown;
  playlists?: Array<{ format?: unknown }>;
}

interface SomaFmCatalogRecord {
  id: string;
  title: string;
  description: string;
  genre: string;
  lastPlaying: string;
}

function catalogText(value: unknown, maximum = 300): string {
  return scalar(value).replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function somaFmRecord(value: SomaFmChannel): SomaFmCatalogRecord | null {
  const id = catalogText(value.id, 64);
  const title = catalogText(value.title);
  const hasMp3Playlist =
    Array.isArray(value.playlists) && value.playlists.some((playlist) => catalogText(playlist.format) === 'mp3');
  if (!SOMAFM_ID.test(id) || !title || !hasMp3Playlist) return null;

  return {
    id,
    title,
    description: catalogText(value.description, 500),
    genre: catalogText(value.genre),
    lastPlaying: catalogText(value.lastPlaying),
  };
}

async function fetchSomaFmRecords(req: NextRequest): Promise<SomaFmCatalogRecord[]> {
  const upstream = await upstreamFetch(req, `${SOMAFM_API}/channels.json`);
  if (!upstream.ok) throw new Error(`SomaFM upstream error (${upstream.status})`);
  const payload = (await upstream.json()) as { channels?: unknown; error?: unknown };
  if (hasUpstreamError(payload)) throw new Error('SomaFM upstream error');
  const channels = Array.isArray(payload.channels) ? payload.channels : [];
  return channels
    .map((channel) => somaFmRecord(channel as SomaFmChannel))
    .filter((record): record is SomaFmCatalogRecord => record !== null);
}

function somaFmPlaylistStreamUrl(playlist: string): string {
  for (const line of playlist.split(/\r?\n/)) {
    const match = /^File\d+=(.+)$/i.exec(line.trim());
    if (!match) continue;
    try {
      const url = new URL(match[1]);
      if (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.port &&
        url.hostname.endsWith('.somafm.com')
      ) {
        return url.toString();
      }
    } catch {
      // Ignore malformed fallback entries and continue through the official playlist.
    }
  }
  return '';
}

async function handleSomaFm(req: NextRequest, resource: string | undefined, rest: string[]): Promise<NextResponse> {
  if (resource === 'stream') {
    const stationId = somaFmId(rest[0]);
    if (stationId instanceof NextResponse) return stationId;
    if (rest.length !== 1) return NextResponse.json({ error: 'Invalid SomaFM station ID' }, { status: 400 });

    try {
      const playlist = await upstreamFetch(req, `${SOMAFM_STREAM_API}/${encodeURIComponent(stationId)}.pls`);
      if (!playlist.ok) return new NextResponse('Stream unavailable', { status: 404 });
      const streamUrl = somaFmPlaylistStreamUrl(await playlist.text());
      if (!streamUrl) return new NextResponse('Stream unavailable', { status: 404 });
      return proxyStream(req, streamUrl, MEDIA_HOSTS.somafm, undefined, true);
    } catch (error) {
      return providerFailure(error, 'SomaFM stream fetch failed');
    }
  }

  if (resource !== 'stations' || rest.length > 0) {
    return NextResponse.json({ error: `Unknown SomaFM endpoint: ${resource ?? ''}` }, { status: 400 });
  }

  const searchParams = req.nextUrl.searchParams;
  const id = searchParams.get('id');
  const query = searchParams.get('q');
  const tag = searchParams.get('tag');
  if (selectorCount([id, query, tag]) > 1) {
    return NextResponse.json({ error: 'Choose one SomaFM station selector' }, { status: 400 });
  }
  const limit = boundedLimit(searchParams, 20, 50);
  if (limit instanceof NextResponse) return limit;

  try {
    const records = await fetchSomaFmRecords(req);
    if (id !== null) {
      const stationId = somaFmId(id);
      if (stationId instanceof NextResponse) return stationId;
      return catalogResponse({ results: records.filter((record) => record.id === stationId) });
    }

    const needle =
      query !== null
        ? queryValue(searchParams, 'q', 'query')
        : tag !== null
          ? queryValue(searchParams, 'tag', 'tag')
          : '';
    if (needle instanceof NextResponse) return needle;
    const normalizedNeedle = needle.toLocaleLowerCase();
    const filtered = normalizedNeedle
      ? records.filter((record) =>
          `${record.title} ${record.description} ${record.genre}`.toLocaleLowerCase().includes(normalizedNeedle),
        )
      : records;
    return catalogResponse({ results: filtered.slice(0, Number(limit)) });
  } catch (error) {
    return providerFailure(error, 'SomaFM fetch failed');
  }
}

interface RadioBrowserStation {
  stationuuid?: unknown;
  name?: unknown;
  url_resolved?: unknown;
  homepage?: unknown;
  tags?: unknown;
  codec?: unknown;
  bitrate?: unknown;
  countrycode?: unknown;
  lastcheckok?: unknown;
}

interface RadioBrowserCatalogRecord {
  id: string;
  name: string;
  streamUrl: string;
  homepage: string;
  tags: string;
  codec: string;
  bitrate: number;
  countryCode: string;
}

function safeRadioWebsite(value: unknown): string {
  const raw = scalar(value);
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.toString()
      : 'https://www.radio-browser.info/';
  } catch {
    return 'https://www.radio-browser.info/';
  }
}

function radioStreamUrl(value: unknown): string {
  const raw = scalar(value);
  try {
    const url = new URL(raw);
    const pathname = url.pathname.toLocaleLowerCase();
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      /\.(m3u8?|pls)$/i.test(pathname) ||
      pathname.includes('/hls/')
    ) {
      return '';
    }
    return url.toString();
  } catch {
    return '';
  }
}

function radioCodec(value: unknown): { codec: string; suffix: string } | null {
  const codec = catalogText(value, 20).toLocaleLowerCase();
  if (codec.includes('mp3')) return { codec: 'audio/mpeg', suffix: 'mp3' };
  if (codec.includes('aac')) return { codec: 'audio/aac', suffix: 'aac' };
  if (codec.includes('opus') || codec.includes('ogg')) return { codec: 'audio/ogg', suffix: 'ogg' };
  if (codec.includes('flac')) return { codec: 'audio/flac', suffix: 'flac' };
  return null;
}

function radioBrowserRecord(value: RadioBrowserStation): RadioBrowserCatalogRecord | null {
  const id = catalogText(value.stationuuid, 36);
  const name = catalogText(value.name);
  const streamUrl = radioStreamUrl(value.url_resolved);
  const format = radioCodec(value.codec);
  const tags = catalogText(value.tags, 500);
  const musicText = `${name} ${tags}`;
  const lastCheckOk = value.lastcheckok === 1 || value.lastcheckok === '1';
  if (
    !RADIO_STATION_ID.test(id) ||
    !name ||
    !streamUrl ||
    !format ||
    !lastCheckOk ||
    !MUSIC_STATION_TERMS.test(musicText)
  ) {
    return null;
  }

  return {
    id,
    name,
    streamUrl,
    homepage: safeRadioWebsite(value.homepage),
    tags,
    codec: format.codec,
    bitrate: Math.max(0, Math.round(Number(value.bitrate) || 0)),
    countryCode: catalogText(value.countrycode, 8).toUpperCase(),
  };
}

async function handleRadioBrowser(
  req: NextRequest,
  resource: string | undefined,
  rest: string[],
): Promise<NextResponse> {
  if (resource !== 'stations' || rest.length > 0) {
    return NextResponse.json({ error: `Unknown radio endpoint: ${resource ?? ''}` }, { status: 400 });
  }

  const searchParams = req.nextUrl.searchParams;
  const id = searchParams.get('id');
  const query = searchParams.get('q');
  const tag = searchParams.get('tag');
  if (selectorCount([id, query, tag]) > 1) {
    return NextResponse.json({ error: 'Choose one radio station selector' }, { status: 400 });
  }
  const limit = boundedLimit(searchParams, 20, 50);
  if (limit instanceof NextResponse) return limit;

  let endpoint: string;
  let searchKey: 'name' | 'tag' | null = null;
  let searchTerm = '';
  if (id !== null) {
    const stationId = radioStationId(id);
    if (stationId instanceof NextResponse) return stationId;
    endpoint = `/stations/byuuid/${encodeURIComponent(stationId)}`;
  } else if (query !== null || tag !== null) {
    const selector = query !== null ? queryValue(searchParams, 'q', 'query') : queryValue(searchParams, 'tag', 'tag');
    if (selector instanceof NextResponse) return selector;
    endpoint = '/stations/search';
    searchKey = query !== null ? 'name' : 'tag';
    searchTerm = selector;
  } else {
    endpoint = `/stations/topclick/${limit}`;
  }

  for (const api of RADIO_BROWSER_APIS) {
    const url = new URL(`${api}${endpoint}`);
    if (searchKey) url.searchParams.set(searchKey, searchTerm);
    url.searchParams.set('hidebroken', 'true');
    url.searchParams.set('order', 'clickcount');
    url.searchParams.set('reverse', 'true');
    url.searchParams.set('limit', limit);

    try {
      const upstream = await upstreamFetch(req, url.toString(), {
        headers: { 'user-agent': RADIO_BROWSER_USER_AGENT },
      });
      if (!upstream.ok) {
        void upstream.body?.cancel().catch(() => undefined);
        continue;
      }
      const payload: unknown = await upstream.json();
      if (hasUpstreamError(payload)) continue;
      const stations = Array.isArray(payload) ? payload : [payload];
      return catalogResponse({
        results: stations
          .map((station) => radioBrowserRecord(station as RadioBrowserStation))
          .filter((station): station is RadioBrowserCatalogRecord => station !== null),
      });
    } catch (error) {
      if (req.signal.aborted) return providerFailure(error, 'Radio Browser fetch failed');
    }
  }

  return NextResponse.json({ error: 'Radio Browser upstream error' }, { status: 503 });
}

interface WikimediaImageInfo {
  url?: unknown;
  descriptionurl?: unknown;
  mime?: unknown;
  duration?: unknown;
  size?: unknown;
  extmetadata?: Record<string, { value?: unknown }>;
}

interface WikimediaPage {
  pageid?: unknown;
  title?: unknown;
  imageinfo?: WikimediaImageInfo[];
}

interface WikimediaCatalogRecord {
  id: number;
  title: string;
  url: string;
  descriptionUrl: string;
  mime: string;
  duration: number;
  size: number;
  artist: string;
  description: string;
  licenseUrl: string;
  date: string;
  categories: string;
}

function plainWikimediaText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function validWikimediaUploadUrl(value: unknown): string {
  const raw = scalar(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.hostname === WIKIMEDIA_UPLOAD_HOST
      ? url.toString()
      : '';
  } catch {
    return '';
  }
}

function wikimediaPageUrl(value: unknown, pageId: number): string {
  const raw = scalar(value);
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:' && url.hostname === 'commons.wikimedia.org') return url.toString();
    } catch {
      // Use the stable Commons detail page below.
    }
  }
  return `https://commons.wikimedia.org/?curid=${pageId}`;
}

function wikimediaMetadata(info: WikimediaImageInfo, key: string): string {
  return plainWikimediaText(scalar(info.extmetadata?.[key]?.value));
}

function wikimediaRecord(page: WikimediaPage): WikimediaCatalogRecord | null {
  if (typeof page.pageid !== 'number' || !Number.isSafeInteger(page.pageid) || page.pageid < 1) return null;
  const title = scalar(page.title);
  const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : undefined;
  if (!title || !info) return null;
  const url = validWikimediaUploadUrl(info.url);
  const size = Number(info.size);
  const duration = parseDuration(info.duration);
  if (!url || !Number.isFinite(size) || size <= 0 || duration <= 0) return null;

  return {
    id: page.pageid,
    title,
    url,
    descriptionUrl: wikimediaPageUrl(info.descriptionurl, page.pageid),
    mime: scalar(info.mime),
    duration,
    size,
    artist: wikimediaMetadata(info, 'Artist'),
    description: wikimediaMetadata(info, 'ImageDescription'),
    licenseUrl: scalar(info.extmetadata?.LicenseUrl?.value),
    date: wikimediaMetadata(info, 'DateTimeOriginal') || wikimediaMetadata(info, 'DateTime'),
    categories: wikimediaMetadata(info, 'Categories'),
  };
}

function isPlayableWikimediaAudio(record: WikimediaCatalogRecord): boolean {
  const media = `${record.mime} ${new URL(record.url).pathname}`.toLowerCase();
  const supportedFormat =
    media.includes('mp3') ||
    media.includes('audio/mpeg') ||
    media.includes('ogg') ||
    media.includes('oga') ||
    media.includes('opus') ||
    media.includes('flac') ||
    media.includes('m4a') ||
    media.includes('aac') ||
    media.includes('mp4') ||
    media.includes('wav');

  return (
    record.duration >= MIN_FULL_TRACK_DURATION_SECONDS &&
    Number.isFinite(record.size) &&
    record.size > 0 &&
    supportedFormat &&
    normalizeCreativeCommonsLicense(record.licenseUrl) !== null
  );
}

function wikimediaSearchText(value: string): string {
  const normalized = value
    .replace(/["{}[\]|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized ? `"${normalized}"` : 'music';
}

async function fetchWikimediaRecords(
  req: NextRequest,
  options: { pageId?: string; query?: string; limit?: string; recent?: boolean },
): Promise<WikimediaCatalogRecord[]> {
  const url = new URL(WIKIMEDIA_COMMONS_API);
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|mime|size|extmetadata');

  if (options.pageId) {
    url.searchParams.set('pageids', options.pageId);
  } else {
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrnamespace', '6');
    url.searchParams.set('gsrlimit', options.limit || '12');
    url.searchParams.set(
      'gsrsearch',
      `incategory:"Music" filetype:audio ${wikimediaSearchText(options.query || 'music')}`,
    );
    if (options.recent) url.searchParams.set('gsrsort', 'create_timestamp_desc');
  }

  const upstream = await upstreamFetch(req, url.toString(), { headers: { 'user-agent': WIKIMEDIA_USER_AGENT } });
  if (!upstream.ok) throw new Error(`Wikimedia upstream error (${upstream.status})`);
  const payload = (await upstream.json()) as { query?: { pages?: WikimediaPage[] }; error?: unknown };
  if (hasUpstreamError(payload)) throw new Error('Wikimedia upstream error');
  const pages = Array.isArray(payload.query?.pages) ? payload.query.pages : [];
  return pages.map(wikimediaRecord).filter((record): record is WikimediaCatalogRecord => record !== null);
}

async function handleWikimedia(req: NextRequest, resource: string | undefined, rest: string[]): Promise<NextResponse> {
  if (resource === 'stream') {
    const pageId = numericId(rest[0], 'Wikimedia page ID');
    if (pageId instanceof NextResponse) return pageId;
    if (rest.length !== 1) return NextResponse.json({ error: 'Invalid Wikimedia page ID' }, { status: 400 });

    try {
      const record = (await fetchWikimediaRecords(req, { pageId }))[0];
      if (!record || !isPlayableWikimediaAudio(record)) return new NextResponse('Stream unavailable', { status: 404 });
      return proxyStream(req, record.url, MEDIA_HOSTS.wikimedia);
    } catch (error) {
      return providerFailure(error, 'Wikimedia stream fetch failed');
    }
  }

  if (resource !== 'tracks' || rest.length > 0) {
    return NextResponse.json({ error: `Unknown Wikimedia endpoint: ${resource ?? ''}` }, { status: 400 });
  }

  const searchParams = req.nextUrl.searchParams;
  const id = searchParams.get('id');
  const query = searchParams.get('q');
  if (selectorCount([id, query]) !== 1) {
    return NextResponse.json({ error: 'Choose one Wikimedia audio selector' }, { status: 400 });
  }
  const limit = boundedLimit(searchParams, 12, 20);
  if (limit instanceof NextResponse) return limit;
  const sort = searchParams.get('sort');
  if (sort !== null && sort !== 'recent')
    return NextResponse.json({ error: 'Invalid Wikimedia sort' }, { status: 400 });

  try {
    if (id !== null) {
      const pageId = numericId(id, 'Wikimedia page ID');
      if (pageId instanceof NextResponse) return pageId;
      return catalogResponse({
        results: (await fetchWikimediaRecords(req, { pageId })).filter(isPlayableWikimediaAudio),
      });
    }
    const valid = queryValue(searchParams, 'q', 'query');
    if (valid instanceof NextResponse) return valid;
    return catalogResponse({
      results: (await fetchWikimediaRecords(req, { query: valid, limit, recent: sort === 'recent' })).filter(
        isPlayableWikimediaAudio,
      ),
    });
  } catch (error) {
    return providerFailure(error, 'Wikimedia fetch failed');
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
    case 'deezer':
      return handleDeezer(req, resource, rest);
    case 'audius':
      return handleAudius(req, resource, rest);
    case 'openverse':
      return handleOpenverse(req, resource, rest);
    case 'somafm':
      return handleSomaFm(req, resource, rest);
    case 'radio':
      return handleRadioBrowser(req, resource, rest);
    case 'wikimedia':
      return handleWikimedia(req, resource, rest);
    default:
      return NextResponse.json({ error: `Unknown provider: ${provider ?? ''}` }, { status: 400 });
  }
}
