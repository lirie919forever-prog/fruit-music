import { NextRequest, NextResponse } from 'next/server';

const JAMENDO_API = 'https://api.jamendo.com/v3.0';
const REQUEST_TIMEOUT_MS = 15_000;
const NUMERIC_ID = /^[1-9]\d{0,15}$/;
const ARCHIVE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const CCMIXTER_MEDIA_HOSTS = new Set(['ccmixter.org', 'www.ccmixter.org']);
const ARCHIVE_ENRICHMENT_CONCURRENCY = 4;
const NON_MUSIC_ARCHIVE_TERMS = /\b(audiobook|audio book|librivox|podcast|spoken word|radio (talk|conversation)|lecture|sermon|philosophy|literature|novel|poetry reading)\b/i;
const STREAM_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
] as const;

function requestSignal(request: Request): AbortSignal {
  return AbortSignal.any([
    request.signal,
    AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  ]);
}

function upstreamFetch(request: Request, url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: requestSignal(request) });
}

function providerFailure(error: unknown, message: string): NextResponse {
  const status = error instanceof DOMException && error.name === 'TimeoutError' ? 504 : 502;
  return NextResponse.json({ error: message }, { status });
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
  return !name.startsWith('/') && !name.includes('\\') && !/[\x00-\x1f]/.test(name) &&
    name.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
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
  return typeof file.name === 'string' && safeArchiveFilename(file.name) && file.private !== 'true' &&
    (file.format?.toLowerCase().includes('mp3') === true || file.name.toLowerCase().endsWith('.mp3')) &&
    parseDuration(file.length) > 0;
}

function chooseArchiveFile(files: ArchiveFile[] | undefined): (ArchiveFile & { name: string }) | null {
  const playable = (files || []).filter(playableArchiveFile);
  playable.sort((left, right) => {
    const original = Number(right.format?.toLowerCase().includes('vbr mp3')) - Number(left.format?.toLowerCase().includes('vbr mp3'));
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
        ['/by-nc-nd/', 'CC BY-NC-ND'], ['/by-nc-sa/', 'CC BY-NC-SA'], ['/by-nc/', 'CC BY-NC'],
        ['/by-nd/', 'CC BY-ND'], ['/by-sa/', 'CC BY-SA'], ['/by/', 'CC BY'], ['/publicdomain/zero/', 'CC0'],
      ];
      const name = labels.find(([part]) => url.pathname.toLowerCase().includes(part))?.[1];
      if (!name) continue;
      url.protocol = 'https:';
      return { name, url: url.toString() };
    } catch { continue; }
  }
  return null;
}

async function mapConcurrent<T, U>(items: T[], concurrency: number, mapper: (item: T) => Promise<U | null>): Promise<U[]> {
  const output: U[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        const value = await mapper(items[index]);
        if (value !== null) output.push(value);
      } catch { /* An invalid Archive candidate is omitted, not fabricated. */ }
    }
  }));
  return output;
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

async function proxyStream(
  request: NextRequest,
  streamUrl: string,
  init: RequestInit = {},
): Promise<NextResponse> {
  const requestHeaders = new Headers();
  const range = request.headers.get('range');
  const ifRange = request.headers.get('if-range');
  if (range) requestHeaders.set('range', range);
  if (ifRange) requestHeaders.set('if-range', ifRange);

  try {
    const upstream = await upstreamFetch(request, streamUrl, {
      ...init,
      headers: requestHeaders,
    });
    const headers = new Headers();
    for (const name of STREAM_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    headers.set('Cache-Control', 'private, no-store');
    headers.set('Vary', 'Range');

    return new NextResponse(upstream.body, {
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
    return proxyStream(req, `https://mp3l.jamendo.com/?trackid=${trackId}&format=mp31`);
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
    const data = await upstream.json() as {
      headers?: { status?: string; error_message?: string; next?: string };
    };
    if (data.headers?.status === 'failed') {
      return NextResponse.json(
        { error: data.headers.error_message || 'Jamendo API error' },
        { status: 502 },
      );
    }
    if (data.headers) delete data.headers.next;
    return NextResponse.json(data);
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
      const metadata = await upstreamFetch(req, `https://ccmixter.org/api/query?upload_id=${uploadId}&format=json&f=json`);
      if (!metadata.ok) return new NextResponse('Stream metadata unavailable', { status: metadata.status });
      const tracks = await metadata.json() as Array<{
        files?: Array<{ download_url?: string; file_format_info?: { mime_type?: string } }>;
      }>;
      const mp3File = tracks[0]?.files?.find(file =>
        file.file_format_info?.mime_type === 'audio/mpeg' && Boolean(file.download_url)
      );
      const downloadUrl = mp3File?.download_url;
      if (!downloadUrl) return new NextResponse('Stream unavailable', { status: 404 });

      const parsedUrl = new URL(downloadUrl);
      if (
        parsedUrl.protocol !== 'https:' ||
        parsedUrl.username ||
        parsedUrl.password ||
        parsedUrl.port ||
        !CCMIXTER_MEDIA_HOSTS.has(parsedUrl.hostname.toLowerCase())
      ) {
        return new NextResponse('Stream unavailable', { status: 502 });
      }
      return proxyStream(req, parsedUrl.toString(), { redirect: 'manual' });
    } catch (error) {
      return providerFailure(error, 'ccMixter stream fetch failed');
    }
  }

  if (resource === 'tracks') {
    const searchParams = new URLSearchParams(req.nextUrl.searchParams);
    searchParams.delete('path');
    searchParams.set('format', 'json');
    searchParams.set('f', 'json');
    // ccMixter can overflow response headers at 30+ results; retain the provider cap.
    const limit = boundedLimit(searchParams, 25, 25, true);
    if (limit instanceof NextResponse) return limit;
    searchParams.set('limit', limit);

    try {
      const upstream = await upstreamFetch(req, `https://ccmixter.org/api/query?${searchParams.toString()}`);
      if (!upstream.ok) {
        return NextResponse.json({ error: 'ccMixter upstream error' }, { status: upstream.status });
      }
      return NextResponse.json({ results: await upstream.json() });
    } catch (error) {
      return providerFailure(error, 'ccMixter fetch failed');
    }
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
      const data = await metadata.json() as { files?: ArchiveFile[] };
      const requestedFile = req.nextUrl.searchParams.get('file');
      const mp3 = requestedFile
        ? data.files?.find((file): file is ArchiveFile & { name: string } => file.name === requestedFile && playableArchiveFile(file)) || null
        : chooseArchiveFile(data.files);
      if (!mp3) return new NextResponse('Stream unavailable', { status: 404 });

      const downloadUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${mp3.name.split('/').map(encodeURIComponent).join('/')}`;
      return proxyStream(req, downloadUrl);
    } catch (error) {
      return providerFailure(error, 'Archive stream fetch failed');
    }
  }

  if (resource === 'tracks') {
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
      const data = await upstream.json() as { response?: { docs?: Array<Record<string, unknown>> } };
      const candidates = Array.isArray(data.response?.docs) ? data.response.docs : [];
      const results = await mapConcurrent(candidates, ARCHIVE_ENRICHMENT_CONCURRENCY, async (doc) => {
        const identifier = scalar(doc.identifier);
        const searchLicense = archiveLicense(doc.licenseurl);
        if (!identifier || !ARCHIVE_ID.test(identifier) || !searchLicense) return null;
        const metadataResponse = await upstreamFetch(req, `https://archive.org/metadata/${encodeURIComponent(identifier)}`);
        if (!metadataResponse.ok) return null;
        const item = await metadataResponse.json() as { metadata?: Record<string, unknown>; files?: ArchiveFile[] };
        const metadata = item.metadata || {};
        const license = archiveLicense(metadata.licenseurl) || searchLicense;
        const file = chooseArchiveFile(item.files);
        const title = scalar(metadata.title) || scalar(doc.title);
        const creatorName = scalar(metadata.creator) || scalar(doc.creator);
        const subjects = [...(Array.isArray(metadata.subject) ? metadata.subject : [metadata.subject]), ...(Array.isArray(doc.subject) ? doc.subject : [doc.subject])]
          .map(scalar).filter(Boolean);
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
      });
      return NextResponse.json({ results: results.slice(0, Number(limit)) });
    } catch (error) {
      return providerFailure(error, 'Archive fetch failed');
    }
  }

  return NextResponse.json({ error: `Unknown archive endpoint: ${resource ?? ''}` }, { status: 400 });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const pathSegments = (await params).path || [];
  const [provider, resource, ...rest] = pathSegments;

  switch (provider) {
    case 'jamendo': return handleJamendo(req, resource, rest);
    case 'ccmixter': return handleCCMixter(req, resource, rest);
    case 'archive': return handleArchive(req, resource, rest);
    default: return NextResponse.json({ error: `Unknown provider: ${provider ?? ''}` }, { status: 400 });
  }
}
