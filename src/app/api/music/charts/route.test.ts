import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_LX_ENABLED', 'true');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('chart availability', () => {
  it('does not contact upstream services when LX Music is disabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_LX_ENABLED', 'false');
    vi.stubEnv('LX_API_BASE', 'https://resolver.example.test');
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());

    const { GET } = await import('./route');
    const response = await GET(new Request('https://marea.test/api/music/charts?chart=jp'));

    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a same-title result from the wrong artist instead of fabricating a chart track', async () => {
    vi.resetModules();
    vi.stubEnv('LX_API_BASE', 'https://resolver.example.test');
    vi.stubEnv('LX_RESOLVER_BASE', '');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ feed: { results: [{ id: 'apple-1', name: "It's Me", artistName: 'ILLIT' }] } }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'wrong', song: "It's Me", singer: '瑄瑄' }] })));

    const { GET } = await import('./route');
    const response = await GET(new Request('https://marea.test/api/music/charts?chart=jp'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ unavailable: true });
  });

  it('keeps matched chart metadata visible when the optional playback resolver is unavailable', async () => {
    vi.resetModules();
    vi.stubEnv('LX_API_BASE', 'https://resolver.example.test');
    vi.stubEnv('LX_RESOLVER_BASE', '');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ feed: { results: [{ id: 'apple-1', name: 'Brand New', artistName: 'Mrs. GREEN APPLE', artworkUrl100: 'https://is1-ssl.mzstatic.com/image.jpg' }] } }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: '123', song: 'Brand New', singer: 'Mrs. GREEN APPLE', album: 'Brand New' }] }))
      .mockResolvedValueOnce(Response.json({ code: 1, msg: 'unavailable' })));

    const { GET } = await import('./route');
    const response = await GET(new Request('https://marea.test/api/music/charts?chart=jp'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      name: 'J-Pop',
      results: [{ title: 'Brand New', artist: 'Mrs. GREEN APPLE', playbackUnavailable: true }],
    });
  });

  it('uses the Apple US chart identity rather than calling it Billboard', async () => {
    vi.resetModules();
    vi.stubEnv('LX_API_BASE', 'https://resolver.example.test');
    vi.stubEnv('LX_RESOLVER_BASE', '');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ feed: { results: [{ id: 'apple-1', name: 'Track', artistName: 'Artist' }] } }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: '123', song: 'Track', singer: 'Artist' }] }))
      .mockResolvedValueOnce(Response.json({ url: 'https://resolver.example.test/media/123.mp3' })));

    const { GET } = await import('./route');
    const response = await GET(new Request('https://marea.test/api/music/charts?chart=billboard'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: 'Apple US Top Songs' });
  });

  it('bounds concurrent chart enrichment requests', async () => {
    vi.resetModules();
    vi.stubEnv('LX_API_BASE', 'https://resolver.example.test');
    vi.stubEnv('LX_RESOLVER_BASE', '');
    const feedResults = Array.from({ length: 12 }, (_, index) => ({
      id: `apple-${index}`,
      name: 'Track',
      artistName: 'Artist',
    }));
    let active = 0;
    let maxActive = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('rss.applemarketingtools.com')) {
        return Response.json({ feed: { results: feedResults } });
      }

      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      if (url.includes('api.vkeys.cn')) {
        return Response.json({ data: [{ id: '123', song: 'Track', singer: 'Artist' }] });
      }
      return Response.json({ url: 'https://resolver.example.test/media/123.mp3' });
    }));

    const { GET } = await import('./route');
    const response = await GET(new Request('https://marea.test/api/music/charts?chart=jp'));
    const body = await response.json() as { results: unknown[] };

    expect(response.status).toBe(200);
    expect(body.results).toHaveLength(12);
    expect(maxActive).toBeLessThanOrEqual(5);
  });
});
