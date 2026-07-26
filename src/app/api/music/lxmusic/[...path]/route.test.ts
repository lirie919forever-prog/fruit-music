import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyLxRoute } from '../routeClassification';
import { mediaContentType } from './route';

async function loadRoute() {
  vi.resetModules();
  process.env.LX_RESOLVER_BASE = 'https://lx.xiaomusic.dpdns.org';
  return (await import('./route')).GET;
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_LX_ENABLED', 'true');
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete process.env.LX_API_BASE;
  delete process.env.LX_RESOLVER_BASE;
});

describe('LX Music API route', () => {
  it('does not contact upstream services when LX Music is disabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_LX_ENABLED', 'false');
    process.env.LX_API_BASE = 'https://lx.xiaomusic.dpdns.org';
    vi.resetModules();

    const { GET } = await import('./route');
    const response = await GET(
      new Request('http://localhost/api/music/lxmusic/search?key=test'),
      { params: Promise.resolve({ path: ['search'] }) },
    );

    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('classifies lxmusic buckets correctly', () => {
    expect(classifyLxRoute('lxmusic', 'search')).toEqual({ bucket: 'lxmusic:search', isStream: false });
    expect(classifyLxRoute('lxmusic', 'url')).toEqual({ bucket: 'lxmusic:url', isStream: true });
  });

  it('normalizes media type parameters for browser compatibility', () => {
    expect(mediaContentType('audio/mpeg; charset=utf-8')).toBe('audio/mpeg');
    expect(mediaContentType('audio/mpeg')).toBe('audio/mpeg');
  });

  it('rejects invalid lxmusic bucket combos', () => {
    expect(classifyLxRoute('lxmusic', 'tracks')).toEqual({ bucket: 'invalid', isStream: false });
    expect(classifyLxRoute('lxmusic', undefined)).toEqual({ bucket: 'invalid', isStream: false });
  });

  it('returns 503 when LX_API_BASE is not set', async () => {
    delete process.env.LX_API_BASE;
    vi.resetModules();
    const { GET } = await import('./route');
    const response = await GET(new Request('http://localhost/api/music/lxmusic/search'), { params: Promise.resolve({ path: ['search'] }) });
    expect(response.status).toBe(503);
  });

  it('allows resolver-only configuration for stream resolution', async () => {
    delete process.env.LX_API_BASE;
    process.env.LX_RESOLVER_BASE = 'https://resolver.example.test';
    vi.resetModules();
    const { GET } = await import('./route');
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ url: 'https://resolver.example.test/media/song.mp3', extra: { expire: { time: Date.now() + 120_000 } } }))
      .mockResolvedValueOnce(new Response('audio', { status: 200, headers: { 'content-type': 'audio/mpeg' } }));

    const response = await GET(
      new Request('http://localhost/api/music/lxmusic/url?id=lxmusic-wy_1_123&platform=wy&rawId=123&type=1'),
      { params: Promise.resolve({ path: ['url'] }) },
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns 400 for missing search key', async () => {
    const GET = await loadRoute();
    const response = await GET(new Request('http://localhost/api/music/lxmusic/search'), { params: Promise.resolve({ path: ['search'] }) });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Missing search key');
  });

  it('rejects oversize search key', async () => {
    const GET = await loadRoute();
    const url = new URL('http://localhost/api/music/lxmusic/search');
    url.searchParams.set('key', 'x'.repeat(201));
    const response = await GET(new Request(url.toString()), { params: Promise.resolve({ path: ['search'] }) });
    expect(response.status).toBe(400);
  });

  it('forwards search to upstream with X-Request-Key header', async () => {
    process.env.LX_API_BASE = 'https://lx.xiaomusic.dpdns.org';
    const GET = await loadRoute();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ code: 0, data: { total: 0, result: [] } }));
    const url = new URL('http://localhost/api/music/lxmusic/search');
    url.searchParams.set('key', 'test');
    url.searchParams.set('type', '1');

    await GET(new Request(url.toString()), { params: Promise.resolve({ path: ['search'] }) });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [upstream, options] = vi.mocked(fetch).mock.calls[0];
    expect(new URL(String(upstream)).href).toBe('https://lx.xiaomusic.dpdns.org/search/1/test/1');
    const headers = new Headers(options?.headers);
    expect(headers.get('X-Request-Key')).toBe('share-v3');
    expect(headers.get('User-Agent')).toBe('lx-music-api/1.0');
  });

  it('validates search type parameter', async () => {
    const GET = await loadRoute();
    const url = new URL('http://localhost/api/music/lxmusic/search');
    url.searchParams.set('key', 'test');
    url.searchParams.set('type', '99');
    const response = await GET(new Request(url.toString()), { params: Promise.resolve({ path: ['search'] }) });
    expect(response.status).toBe(400);
  });

  it('returns 400 for missing platform in url handler', async () => {
    const GET = await loadRoute();
    const url = new URL('http://localhost/api/music/lxmusic/url');
    url.searchParams.set('id', 'lxmusic-wy_1_123');
    url.searchParams.set('level', '320');
    url.searchParams.set('rawId', '123');
    url.searchParams.set('type', '1');
    const response = await GET(new Request(url.toString()), { params: Promise.resolve({ path: ['url'] }) });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Missing platform parameter');
  });

  it('caches LX search responses with CDN headers', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ code: 0, data: { total: 0, result: [] } }));
    const url = new URL('http://localhost/api/music/lxmusic/search');
    url.searchParams.set('key', 'test');
    const response = await GET(new Request(url.toString()), { params: Promise.resolve({ path: ['search'] }) });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('s-maxage=');
    expect(response.headers.get('vercel-cdn-cache-control')).toBe(response.headers.get('cache-control'));
  });
});
