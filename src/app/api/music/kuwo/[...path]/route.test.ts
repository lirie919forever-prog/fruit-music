import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadRoute() {
  vi.resetModules();
  return (await import('./route')).GET;
}

function request(path: string, headers?: HeadersInit): Request {
  return new Request(`http://localhost/api/music/kuwo/${path}`, { headers });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Kuwo API route', () => {
  it('normalizes Kuwo search JSON and preserves query parameters', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("{'abslist':[{'DC_TARGETID':'376838694','NAME':'海のまにまに&nbsp;','ARTIST':'YOASOBI','DURATION':'292'}]}", {
        status: 200,
      }),
    );

    const response = await GET(request('search?key=YOASOBI'), { params: Promise.resolve({ path: ['search'] }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      abslist: [{ DC_TARGETID: '376838694', NAME: '海のまにまに&nbsp;', ARTIST: 'YOASOBI', DURATION: '292' }],
    });
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(new URL(String(url)).hostname).toBe('search.kuwo.cn');
    expect(new URL(String(url)).searchParams.get('all')).toBe('YOASOBI');
  });

  it('proxies a full audio response and forwards range headers', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response('http://nf.sycdn.kuwo.cn/path/song.mp3', { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response('audio', {
          status: 206,
          headers: {
            'content-type': 'audio/mpeg',
            'content-range': 'bytes 0-4/181521',
            'content-length': '5',
            'accept-ranges': 'bytes',
          },
        }),
      );

    const response = await GET(request('url?rid=376838694', { range: 'bytes=0-4' }), {
      params: Promise.resolve({ path: ['url'] }),
    });

    expect(response.status).toBe(206);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).toBe('audio');
    const [, options] = vi.mocked(fetch).mock.calls[1];
    expect(new Headers(options?.headers).get('range')).toBe('bytes=0-4');
  });

  it('rejects a resolver URL outside the Kuwo media CDN', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('http://169.254.169.254/latest/meta-data', { status: 200 }));

    const response = await GET(request('url?rid=376838694'), { params: Promise.resolve({ path: ['url'] }) });

    expect(response.status).toBe(502);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid track identities before contacting upstream', async () => {
    const GET = await loadRoute();
    const response = await GET(request('url?rid=../admin'), { params: Promise.resolve({ path: ['url'] }) });

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
