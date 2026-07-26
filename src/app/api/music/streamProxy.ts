import { NextResponse } from 'next/server';

/**
 * The plumbing shared by every media proxy in this app.
 *
 * These helpers existed twice, character for character, in
 * `music/[...path]/route.ts` and `music/lxmusic/[...path]/route.ts`. Two copies
 * of a body-streaming abort dance is two places for a leak to be fixed in only
 * one of them, and the redirect handling had already diverged: the lxmusic copy
 * validated every hop against an allowlist while the other followed redirects
 * blind.
 */

export const STREAM_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
] as const;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function setCdnCacheHeaders(headers: Headers, value: string): void {
  headers.set('Cache-Control', value);
  headers.set('Vercel-CDN-Cache-Control', value);
  headers.set('CDN-Cache-Control', value);
}

export function mediaContentType(value: string | null): string | null {
  if (!value) return null;
  const mediaType = value.split(';', 1)[0].trim().toLowerCase();
  return mediaType || null;
}

export function closeUpstream(response: Response, cleanup: () => void): void {
  cleanup();
  void response.body?.cancel().catch(() => undefined);
}

export function validContentRange(value: string | null): boolean {
  if (!value) return false;
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(value.trim());
  if (!match) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === '*' ? 0 : Number(match[3]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start && (total === 0 || end < total);
}

export function providerFailure(error: unknown, message: string): NextResponse {
  const status = error instanceof DOMException && error.name === 'TimeoutError' ? 504 : 502;
  return NextResponse.json({ error: message }, { status });
}

export function requestSignal(request: Request, timeoutMs: number): AbortSignal {
  return AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
}

export interface StreamFetchResult {
  response: Response;
  controller: AbortController;
  cleanup: () => void;
}

/**
 * Fetches with a timeout that covers the response *headers* only.
 *
 * A shared `AbortSignal.timeout` would cut the body off mid-track, so the timer
 * is cleared the moment headers arrive and the controller is handed back for
 * the body's own lifetime to manage.
 */
export async function streamFetch(
  request: Request,
  url: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<StreamFetchResult> {
  const controller = new AbortController();
  const abortFromRequest = () => controller.abort(request.signal.reason);
  if (request.signal.aborted) abortFromRequest();
  else request.signal.addEventListener('abort', abortFromRequest, { once: true });

  const timeout = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abortFromRequest);
  };
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timeout);
    return { response, controller, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

export function streamBody(
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
        } else {
          streamController.enqueue(chunk.value);
        }
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

/** A media host predicate. Every provider must supply one; there is no default. */
export type ApprovedMediaHost = (url: URL) => boolean;

/**
 * Builds a host predicate that also rejects anything that is not plain https
 * with no credentials and no explicit port.
 *
 * `suffixes` covers providers that hand a request off to a numbered node —
 * Archive redirects to `dn######.<region>.archive.org` — where enumerating the
 * hosts is not possible and the registrable domain is the real boundary.
 */
export function mediaHostAllowlist(hosts: string[], suffixes: string[] = []): ApprovedMediaHost {
  const exact = new Set(hosts.map((host) => host.toLowerCase()));
  const tails = suffixes.map((suffix) => suffix.toLowerCase());
  return (url) => {
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    return exact.has(host) || tails.some((tail) => host.endsWith(tail));
  };
}

export interface FollowResult {
  ok: true;
  response: Response;
  controller: AbortController;
  cleanup: () => void;
}

export interface FollowFailure {
  ok: false;
  response: NextResponse;
}

/**
 * Fetches media, checking every hop against the provider's allowlist.
 *
 * `redirect: 'manual'` rather than letting fetch follow: an unchecked redirect
 * turns any upstream that can be induced to emit a `Location` into a way to
 * make this server fetch an arbitrary URL and stream the result back. The
 * jamendo, archive and itunes stream paths previously followed blind; only the
 * start URL was ever checked.
 */
export async function fetchApprovedMedia(
  request: Request,
  startUrl: string,
  options: {
    isApproved: ApprovedMediaHost;
    headers: Headers;
    timeoutMs: number;
    maxRedirects?: number;
  },
): Promise<FollowResult | FollowFailure> {
  const unavailable = (): FollowFailure => ({
    ok: false,
    response: new NextResponse('Stream unavailable', { status: 502 }),
  });

  let current: URL;
  try {
    current = new URL(startUrl);
  } catch {
    return unavailable();
  }
  if (!options.isApproved(current)) return unavailable();

  const maxRedirects = options.maxRedirects ?? 3;
  const visited = new Set<string>();

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const href = current.toString();
    // A redirect chain that revisits a URL will never terminate.
    if (visited.has(href)) return { ok: false, response: new NextResponse('Stream redirect loop', { status: 502 }) };
    visited.add(href);

    const fetched = await streamFetch(request, href, options.timeoutMs, {
      headers: options.headers,
      redirect: 'manual',
    });

    if (!REDIRECT_STATUSES.has(fetched.response.status)) {
      return { ok: true, response: fetched.response, controller: fetched.controller, cleanup: fetched.cleanup };
    }

    const location = fetched.response.headers.get('location');
    closeUpstream(fetched.response, fetched.cleanup);
    if (!location) return unavailable();
    let next: URL;
    try {
      next = new URL(location, href);
    } catch {
      return unavailable();
    }
    if (!options.isApproved(next)) return unavailable();
    current = next;
  }

  return { ok: false, response: new NextResponse('Too many stream redirects', { status: 502 }) };
}
