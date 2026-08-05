import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  delete process.env.LYRICS_ENABLED;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.LYRICS_ENABLED;
});

function lrclibRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 496,
    trackName: 'Creep',
    artistName: 'Radiohead',
    albumName: 'Pablo Honey',
    duration: 239,
    instrumental: false,
    plainLyrics: 'When you were here before',
    syncedLyrics: '[00:19.16] When you were here before\n[00:24.09] Could not look you in the eye',
    ...overrides,
  };
}

function ask(query = 'track=Creep&artist=Radiohead'): Request {
  return new Request(`https://marea.test/api/lyrics?${query}`);
}

describe('lyrics route', () => {
  it('returns the parsed synced document for a match', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json([lrclibRecord()])),
    );

    const { GET } = await import('./route');
    const response = await GET(ask());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      found: true,
      lyrics: {
        provider: 'LRCLIB',
        sourceUrl: 'https://lrclib.net/api/get/496',
        trackName: 'Creep',
        artistName: 'Radiohead',
        instrumental: false,
        synced: [
          { time: 19.16, text: 'When you were here before' },
          { time: 24.09, text: 'Could not look you in the eye' },
        ],
        syncedSource: '[00:19.16] When you were here before\n[00:24.09] Could not look you in the eye',
        plain: 'When you were here before',
      },
    });
  });

  it('asks LRCLIB by name and identifies this app in the User-Agent', async () => {
    const fetchMock = vi.fn(async () => Response.json([lrclibRecord()]));
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('./route');
    await GET(ask('track=Creep&artist=Radiohead'));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://lrclib.net/api/search?track_name=Creep&artist_name=Radiohead');
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^Marea\//);
  });

  it('reports not found rather than the nearest wrong song', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json([lrclibRecord({ trackName: 'Karma Police' })])),
    );

    const { GET } = await import('./route');
    const response = await GET(ask());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ found: false });
  });

  it('caches a miss as long as a hit, so a track LRCLIB has never heard of is asked about once', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json([])),
    );

    const { GET } = await import('./route');
    const response = await GET(ask());

    expect(await response.json()).toEqual({ found: false });
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=86400');
  });

  it('treats an upstream 404 as an ordinary miss', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    );

    const { GET } = await import('./route');
    const response = await GET(ask());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ found: false });
  });

  it('does not cache an upstream failure, which says nothing about the lyrics', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );

    const { GET } = await import('./route');
    const response = await GET(ask());

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control') ?? '').not.toContain('s-maxage');
  });

  it('does not cache a network fault either', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    );

    const { GET } = await import('./route');
    const response = await GET(ask());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ found: false, reason: 'unavailable' });
  });

  it('survives a body that is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>maintenance</html>', { status: 200 })),
    );

    const { GET } = await import('./route');
    expect((await GET(ask())).status).toBe(502);
  });

  it('rejects a request with no track or no artist before calling upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('./route');
    expect((await GET(ask('artist=Radiohead'))).status).toBe(400);
    expect((await GET(ask('track=Creep'))).status).toBe(400);
    expect((await GET(ask('track=%20%20&artist=Radiohead'))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an overlong field rather than truncating it', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('./route');
    const response = await GET(ask(`track=${'a'.repeat(201)}&artist=Radiohead`));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores a preview-length duration when choosing between records', async () => {
    // Apple's catalog reports thirty seconds. The full recording is 239.
    // A duration filter applied blindly would reject the only right answer.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json([lrclibRecord()])),
    );

    const { GET } = await import('./route');
    const response = await GET(ask('track=Creep&artist=Radiohead&duration=30'));

    expect(await response.json()).toMatchObject({ found: true });
  });

  it('uses a full-length duration to reject a record that is a different recording', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json([lrclibRecord({ duration: 600 })])),
    );

    const { GET } = await import('./route');
    const response = await GET(ask('track=Creep&artist=Radiohead&duration=239'));

    expect(await response.json()).toEqual({ found: false });
  });

  it('serves nothing and calls nobody when the operator turns lyrics off', async () => {
    process.env.LYRICS_ENABLED = 'false';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('./route');
    const response = await GET(ask());

    expect(await response.json()).toEqual({ found: false, reason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rate limits a client looping on the endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json([])),
    );

    const { GET } = await import('./route');
    const headers = { 'x-real-ip': '203.0.113.7' };
    const looped = new Request('https://marea.test/api/lyrics?track=Creep&artist=Radiohead', { headers });

    let limitedAt = -1;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await GET(looped.clone());
      if (response.status === 429) {
        limitedAt = attempt;
        break;
      }
    }
    expect(limitedAt).toBe(30);
  });
});
