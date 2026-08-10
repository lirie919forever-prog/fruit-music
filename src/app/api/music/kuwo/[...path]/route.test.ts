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
      new Response(
        "{'abslist':[{'DC_TARGETID':'376838694','NAME':'海のまにまに&nbsp;','ARTIST':'YOASOBI','DURATION':'292'}]}",
        {
          status: 200,
        },
      ),
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

  it('repairs mojibake in parsed search metadata before returning JSON', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        "{'abslist':[{'DC_TARGETID':'1','NAME':'\u00e6\u00b5\u00b7\u00e3\u0081\u00ae\u00e3\u0081\u00be\u00e3\u0081\u00ab\u00e3\u0081\u00be\u00e3\u0081\u00ab','ARTIST':'YOASOBI','DURATION':'292'}]}",
        { status: 200 },
      ),
    );

    const response = await GET(request('search?key=YOASOBI'), { params: Promise.resolve({ path: ['search'] }) });

    await expect(response.json()).resolves.toEqual({
      abslist: [{ DC_TARGETID: '1', NAME: '\u6d77\u306e\u307e\u306b\u307e\u306b', ARTIST: 'YOASOBI', DURATION: '292' }],
    });
  });

  it('returns a quiet degraded result for optional resolver searches', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('upstream unavailable', { status: 503 }));

    const response = await GET(request('search?key=YOASOBI&soft=1'), {
      params: Promise.resolve({ path: ['search'] }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      abslist: [],
      degraded: true,
      error: 'Kuwo upstream error (status 503)',
    });
  });

  it('parses apostrophes in Kuwo metadata without corrupting the payload', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        "{'abslist':[{'DC_TARGETID':'1','NAME':'Don\'t Stop Me Now','ARTIST':'Guns N\' Roses','ALBUM':'Greatest &amp; Hits','DURATION':'211'}]}",
        { status: 200 },
      ),
    );

    const response = await GET(request('search?key=queen'), { params: Promise.resolve({ path: ['search'] }) });

    expect(await response.json()).toEqual({
      abslist: [
        {
          DC_TARGETID: '1',
          NAME: "Don't Stop Me Now",
          ARTIST: "Guns N' Roses",
          ALBUM: 'Greatest &amp; Hits',
          DURATION: '211',
        },
      ],
    });
  });

  it('recovers records with a missing quote before the next Kuwo field', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        "{'abslist':[{'DC_TARGETID':'556359138','NAME':'Blinding Lights','ALBUM':'BlindingLights24066249\\\\&quot;,'ALBUMID':'89229471','ARTIST':'The Weeknd','ARTISTID':'479756766','DURATION':'200'}]}",
        { status: 200 },
      ),
    );

    const response = await GET(request('search?key=Blinding%20Lights'), {
      params: Promise.resolve({ path: ['search'] }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      abslist: [
        expect.objectContaining({
          DC_TARGETID: '556359138',
          ALBUM: 'BlindingLights24066249\\&quot;',
          ALBUMID: '89229471',
        }),
      ],
    });
  });

  it('proxies a full audio response and forwards range headers', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('https://kw-bj.kuwo.cn/path/song.mp3', { status: 200 }))
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

  it('probes the resolved media before reporting a stream as available', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('https://kw-lw.kuwo.cn/path/song.mp3', { status: 200 }))
      .mockResolvedValueOnce(
        new Response('audio', {
          status: 206,
          headers: {
            'content-type': 'audio/mpeg',
            'content-range': 'bytes 0-1/181521',
          },
        }),
      );

    const response = await GET(request('url?rid=376838694&probe=1'), {
      params: Promise.resolve({ path: ['url'] }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: true, provider: 'Kuwo' });
    const [, options] = vi.mocked(fetch).mock.calls[1];
    expect(new Headers(options?.headers).get('range')).toBe('bytes=0-1');
  });

  it('rejects a resolver payload that is too small for the expected recording', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('https://nf.sycdn.kuwo.cn/path/song.mp3', { status: 200 }))
      .mockResolvedValueOnce(
        new Response('audio', {
          status: 206,
          headers: {
            'content-type': 'audio/mpeg',
            'content-range': 'bytes 0-1/181521',
          },
        }),
      )
      .mockResolvedValueOnce(new Response('https://nf.sycdn.kuwo.cn/path/song-192.mp3', { status: 200 }))
      .mockResolvedValueOnce(
        new Response('audio', {
          status: 206,
          headers: {
            'content-type': 'audio/mpeg',
            'content-range': 'bytes 0-1/181521',
          },
        }),
      )
      .mockResolvedValueOnce(new Response('https://nf.sycdn.kuwo.cn/path/song-128.mp3', { status: 200 }))
      .mockResolvedValueOnce(
        new Response('audio', {
          status: 206,
          headers: {
            'content-type': 'audio/mpeg',
            'content-range': 'bytes 0-1/181521',
          },
        }),
      );

    const response = await GET(request('url?rid=376838694&probe=1&expected=180'), {
      params: Promise.resolve({ path: ['url'] }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: false, provider: 'Kuwo', code: 'short' });
  });

  it('falls back to a lower public bitrate when the preferred resolver object is a short clip', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('https://nf.sycdn.kuwo.cn/path/song-320.mp3', { status: 200 }))
      .mockResolvedValueOnce(
        new Response('audio', {
          status: 206,
          headers: {
            'content-type': 'audio/mpeg',
            'content-range': 'bytes 0-1/181521',
          },
        }),
      )
      .mockResolvedValueOnce(new Response('https://nf.sycdn.kuwo.cn/path/song-192.mp3', { status: 200 }))
      .mockResolvedValueOnce(
        new Response('audio', {
          status: 206,
          headers: {
            'content-type': 'audio/mpeg',
            'content-range': 'bytes 0-1/3676550',
          },
        }),
      );

    const response = await GET(request('url?rid=631727764&probe=1&expected=229'), {
      params: Promise.resolve({ path: ['url'] }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ available: true, provider: 'Kuwo', bitrate: '192kmp3' });
    const [fallbackUrl] = vi.mocked(fetch).mock.calls[2];
    expect(new URL(String(fallbackUrl)).searchParams.get('br')).toBe('192kmp3');
  });

  it('reports an unavailable media probe as a normal provider result', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('https://nf.sycdn.kuwo.cn/path/song.mp3', { status: 200 }))
      .mockResolvedValueOnce(new Response('blocked', { status: 403, headers: { 'content-type': 'text/plain' } }));

    const response = await GET(request('url?rid=376838694&probe=1'), {
      params: Promise.resolve({ path: ['url'] }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: false, provider: 'Kuwo', code: 'unavailable' });
  });

  it('classifies Kuwo mobile-only resolver responses without exposing upstream text', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('当前音乐只在酷我手机端', { status: 200 }));

    const response = await GET(request('url?rid=376838694'), { params: Promise.resolve({ path: ['url'] }) });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'This track is only available in the Kuwo mobile app.',
      code: 'mobile_only',
      provider: 'Kuwo',
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('keeps unknown non-URL resolver text generic', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('temporary upstream notice', { status: 200 }));

    const response = await GET(request('url?rid=376838694'), { params: Promise.resolve({ path: ['url'] }) });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Kuwo returned an invalid stream URL' });
  });
  it('rejects a resolver URL outside approved Kuwo media hosts', async () => {
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
