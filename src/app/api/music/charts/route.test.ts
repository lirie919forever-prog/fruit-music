import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function feedEntry(id: string) {
  return { id, name: `Track ${id}`, artistName: 'Artist' };
}

function lookupTrack(trackId: number, overrides: Record<string, unknown> = {}) {
  return {
    wrapperType: 'track',
    kind: 'song',
    trackId,
    trackName: `Track ${trackId}`,
    artistId: 9,
    artistName: 'Artist',
    collectionId: 5,
    collectionName: 'Album',
    previewUrl: `https://audio-ssl.itunes.apple.com/${trackId}.m4a`,
    artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/a/100x100bb.jpg',
    ...overrides,
  };
}

function routeFetch(feed: unknown, lookup: unknown) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('rss.marketingtools.apple.com')) return Response.json(feed);
    if (url.includes('itunes.apple.com/lookup')) return Response.json(lookup);
    throw new Error(`unexpected request: ${url}`);
  });
}

describe('chart pages', () => {
  it('resolves a chart entry to a playable Apple preview', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch(
        { feed: { results: [feedEntry('101')] } },
        { results: [lookupTrack(101, { trackTimeMillis: 211_000 })] },
      ),
    );

    const { GET } = await import('./route');
    const response = await GET(new Request('https://marea.test/api/music/charts?chart=billboard'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      name: 'Apple US Top Songs',
      results: [
        {
          id: 'itunes-101',
          title: 'Track 101',
          artist: 'Artist',
          provider: 'Apple Preview',
          path: '/api/music/itunes/stream/101',
          duration: 30,
          recordingDuration: 211,
          licenseName: '30-second preview',
        },
      ],
    });
  });

  it('preserves chart position when the lookup returns another order', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch(
        { feed: { results: [feedEntry('1'), feedEntry('2'), feedEntry('3')] } },
        { results: [lookupTrack(3), lookupTrack(1), lookupTrack(2)] },
      ),
    );

    const { GET } = await import('./route');
    const response = await GET(new Request('https://marea.test/api/music/charts?chart=uk'));
    const body = (await response.json()) as { results: Array<{ id: string }> };

    expect(body.results.map((song) => song.id)).toEqual(['itunes-1', 'itunes-2', 'itunes-3']);
  });

  it('omits an entry with no preview rather than listing something unplayable', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch(
        { feed: { results: [feedEntry('1'), feedEntry('2')] } },
        { results: [lookupTrack(1, { previewUrl: undefined }), lookupTrack(2)] },
      ),
    );

    const { GET } = await import('./route');
    const response = await GET(new Request('https://marea.test/api/music/charts?chart=jp'));
    const body = (await response.json()) as { results: Array<{ id: string; playbackUnavailable?: boolean }> };

    expect(body.results.map((song) => song.id)).toEqual(['itunes-2']);
    expect(body.results.some((song) => song.playbackUnavailable)).toBe(false);
  });

  it('ignores a feed id that is not an Apple track id', async () => {
    const fetchMock = routeFetch({ feed: { results: [{ id: 'apple-1', name: 'Track' }] } }, { results: [] });
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('./route');
    const response = await GET(new Request('https://marea.test/api/music/charts?chart=billboard'));

    expect(response.status).toBe(502);
    // Only the feed is fetched: with no usable ids there is nothing to look up.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown chart', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { GET } = await import('./route');
    const response = await GET(new Request('https://marea.test/api/music/charts?chart=mars'));

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports the chart as unavailable rather than throwing when the lookup fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes('rss.marketingtools.apple.com')) {
          return Response.json({ feed: { results: [feedEntry('101')] } });
        }
        return new Response('nope', { status: 500 });
      }),
    );

    const { GET } = await import('./route');
    const response = await GET(new Request('https://marea.test/api/music/charts?chart=jp'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ unavailable: true });
  });
  it('has no second entry pointing at the same feed', async () => {
    // `pop` used to be a fourth chart on us/most-played/50 — byte-identical to
    // `billboard` — labelled "Global Top Songs" for a US feed.
    vi.stubGlobal('fetch', vi.fn());
    const { GET } = await import('./route');
    const response = await GET(new Request('https://marea.test/api/music/charts?chart=pop'));

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('spends exactly one feed request and one lookup per 25 entries', async () => {
    const ids = Array.from({ length: 50 }, (_, index) => String(index + 1));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('rss.marketingtools.apple.com')) {
        return Response.json({ feed: { results: ids.map((id) => feedEntry(id)) } });
      }
      return Response.json({ results: ids.map((id) => lookupTrack(Number(id))) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('./route');
    await GET(new Request('https://marea.test/api/music/charts?chart=billboard'));

    // The fan-out this endpoint's rate limit is sized against: 1 + ceil(50/25).
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rate limits per chart, so one chart cannot lock out another', async () => {
    vi.stubGlobal('fetch', routeFetch({ feed: { results: [feedEntry('101')] } }, { results: [lookupTrack(101)] }));
    const { GET } = await import('./route');
    const headers = { 'x-real-ip': '203.0.113.9' };

    let last = new Response(null, { status: 200 }) as Response;
    for (let attempt = 0; attempt < 61; attempt += 1) {
      last = await GET(new Request('https://marea.test/api/music/charts?chart=billboard', { headers }));
    }
    expect(last.status).toBe(429);
    expect(last.headers.get('Retry-After')).toBeTruthy();

    // A different chart is a different bucket and is still answerable.
    const other = await GET(new Request('https://marea.test/api/music/charts?chart=jp', { headers }));
    expect(other.status).toBe(200);
  });
});
