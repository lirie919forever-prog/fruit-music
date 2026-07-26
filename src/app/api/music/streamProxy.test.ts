import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchApprovedMedia,
  mediaContentType,
  mediaHostAllowlist,
  providerFailure,
  setCdnCacheHeaders,
  streamBody,
  streamFetch,
  validContentRange,
} from './streamProxy';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function req(): Request {
  return new Request('https://marea.test/stream');
}

describe('media host allowlist', () => {
  const isApproved = mediaHostAllowlist(['archive.org'], ['.archive.org']);

  it('accepts the exact host and its per-node subdomains', () => {
    expect(isApproved(new URL('https://archive.org/download/x.mp3'))).toBe(true);
    expect(isApproved(new URL('https://dn710807.ca.archive.org/0/items/x.mp3'))).toBe(true);
  });

  it('rejects a lookalike that merely ends with the name', () => {
    // The suffix carries its leading dot precisely so this cannot pass.
    expect(isApproved(new URL('https://notarchive.org/x.mp3'))).toBe(false);
    expect(isApproved(new URL('https://archive.org.attacker.example/x.mp3'))).toBe(false);
  });

  it('rejects plain http, credentials and an explicit port', () => {
    expect(isApproved(new URL('http://archive.org/x.mp3'))).toBe(false);
    expect(isApproved(new URL('https://user:pass@archive.org/x.mp3'))).toBe(false);
    expect(isApproved(new URL('https://archive.org:8443/x.mp3'))).toBe(false);
  });
});

describe('following redirects', () => {
  const isApproved = mediaHostAllowlist(['media.test'], ['.media.test']);
  const options = { isApproved, headers: new Headers(), timeoutMs: 1_000 };

  it('returns the first non-redirect response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('bytes', { status: 200 }));

    const result = await fetchApprovedMedia(req(), 'https://media.test/a.mp3', options);

    expect(result.ok).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    // Manual, so nothing is followed without being checked first.
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('follows a redirect that stays inside the allowlist', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://node1.media.test/a.mp3' } }),
      )
      .mockResolvedValueOnce(new Response('bytes', { status: 200 }));

    const result = await fetchApprovedMedia(req(), 'https://media.test/a.mp3', options);

    expect(result.ok).toBe(true);
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe('https://node1.media.test/a.mp3');
  });

  it('refuses a redirect that leaves the allowlist', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://attacker.example/a.mp3' } }),
    );

    const result = await fetchApprovedMedia(req(), 'https://media.test/a.mp3', options);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.response.status).toBe(502);
    // The off-site URL is never fetched at all.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('refuses a start URL outside the allowlist without fetching anything', async () => {
    const result = await fetchApprovedMedia(req(), 'https://attacker.example/a.mp3', options);

    expect(result.ok).toBe(false);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('resolves a relative Location against the current URL', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/moved/a.mp3' } }))
      .mockResolvedValueOnce(new Response('bytes', { status: 200 }));

    await fetchApprovedMedia(req(), 'https://media.test/original/a.mp3', options);

    expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe('https://media.test/moved/a.mp3');
  });

  it('treats a redirect with no Location as a failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 302 }));

    const result = await fetchApprovedMedia(req(), 'https://media.test/a.mp3', options);

    expect(result.ok).toBe(false);
  });

  it('cuts a chain that revisits a URL', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://media.test/loop.mp3' } }),
    );

    const result = await fetchApprovedMedia(req(), 'https://media.test/a.mp3', options);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(await result.response.text()).toBe('Stream redirect loop');
  });

  it('stops after the redirect budget when every hop is new', async () => {
    let hop = 0;
    vi.mocked(fetch).mockImplementation(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: `https://media.test/hop-${hop++}.mp3` },
        }),
    );

    const result = await fetchApprovedMedia(req(), 'https://media.test/a.mp3', { ...options, maxRedirects: 2 });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(await result.response.text()).toBe('Too many stream redirects');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });
});

describe('body streaming', () => {
  it('aborts the upstream when the downstream cancels', async () => {
    const controller = new AbortController();
    const cleanup = vi.fn();
    const upstream = new Response(
      new ReadableStream({
        start() {
          /* never closes */
        },
      }),
    );

    const body = streamBody(upstream, controller, cleanup);
    await body!.cancel('gone');

    expect(cleanup).toHaveBeenCalled();
    expect(controller.signal.aborted).toBe(true);
  });

  it('cleans up and returns null for a body-less response', () => {
    const cleanup = vi.fn();

    expect(streamBody(new Response(null, { status: 204 }), new AbortController(), cleanup)).toBeNull();
    expect(cleanup).toHaveBeenCalled();
  });

  it('clears the header timeout as soon as headers arrive, so a long body survives', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('bytes', { status: 200 }));

    const { response, controller, cleanup } = await streamFetch(req(), 'https://media.test/a.mp3', 5);
    // The timeout only ever covered headers; waiting past it must not abort.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(controller.signal.aborted).toBe(false);
    expect(await response.text()).toBe('bytes');
    cleanup();
  });
});

describe('response helpers', () => {
  it('accepts only a well-formed content-range', () => {
    expect(validContentRange('bytes 0-99/200')).toBe(true);
    expect(validContentRange('bytes 0-99/*')).toBe(true);
    expect(validContentRange('bytes 100-0/200')).toBe(false);
    expect(validContentRange('bytes 0-200/200')).toBe(false);
    expect(validContentRange('items 0-1/2')).toBe(false);
    expect(validContentRange(null)).toBe(false);
  });

  it('strips parameters off a content type and lowercases it', () => {
    expect(mediaContentType('Audio/MPEG; charset=binary')).toBe('audio/mpeg');
    expect(mediaContentType('   ')).toBeNull();
    expect(mediaContentType(null)).toBeNull();
  });

  it('sets the CDN cache headers Vercel and generic CDNs each read', () => {
    const headers = new Headers();
    setCdnCacheHeaders(headers, 'public, s-maxage=60');

    expect(headers.get('Cache-Control')).toBe('public, s-maxage=60');
    expect(headers.get('Vercel-CDN-Cache-Control')).toBe('public, s-maxage=60');
    expect(headers.get('CDN-Cache-Control')).toBe('public, s-maxage=60');
  });

  it('reports a timeout as 504 and everything else as 502', async () => {
    const timeout = providerFailure(new DOMException('Timed out', 'TimeoutError'), 'nope');
    const other = providerFailure(new Error('boom'), 'nope');

    expect(timeout.status).toBe(504);
    expect(other.status).toBe(502);
    expect(await other.json()).toEqual({ error: 'nope' });
  });
});
