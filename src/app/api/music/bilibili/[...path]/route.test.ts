import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BVID = 'BV1z79YBtEhh';
const MEDIA_URL = 'https://upos-sz-mirrorali.bilivideo.com/audio/track.m4s';

async function loadRoute() {
  vi.resetModules();
  return (await import('./route')).GET;
}

function request(path: string, headers?: HeadersInit): Request {
  return new Request(`http://localhost/api/music/bilibili/${path}`, { headers });
}

function viewResponse(): Response {
  return Response.json({ code: 0, data: { pages: [{ cid: 987654321 }] } });
}

function playUrlResponse(url = MEDIA_URL): Response {
  return Response.json({
    code: 0,
    data: {
      dash: {
        audio: [{ base_url: url, mime_type: 'audio/mp4', bandwidth: 192_000 }],
      },
    },
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Bilibili API route', () => {
  it('normalizes the public search response and caches catalog data', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        code: 0,
        data: {
          result: [{ bvid: BVID, title: "ILLIT It's Me", author: 'ILLIT', duration: '2:27' }],
        },
      }),
    );

    const response = await GET(request("tracks?q=ILLIT%20It's%20Me&limit=12"), {
      params: Promise.resolve({ path: ['tracks'] }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [{ bvid: BVID, title: "ILLIT It's Me", author: 'ILLIT', duration: '2:27' }],
    });
    expect(response.headers.get('cache-control')).toContain('s-maxage=300');
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.hostname).toBe('api.bilibili.com');
    expect(parsed.searchParams.get('keyword')).toBe("ILLIT It's Me");
    expect(parsed.searchParams.get('page_size')).toBe('12');
    expect(new Headers(options?.headers).get('referer')).toBe('https://www.bilibili.com/');
  });

  it('probes a DASH audio stream and rejects a byte-short result', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch)
      .mockResolvedValueOnce(viewResponse())
      .mockResolvedValueOnce(playUrlResponse())
      .mockResolvedValueOnce(
        new Response('audio', {
          status: 206,
          headers: {
            'content-type': 'audio/mp4',
            'content-range': 'bytes 0-1/10000',
          },
        }),
      );

    const response = await GET(request(`stream/${BVID}?probe=1&expected=180`), {
      params: Promise.resolve({ path: ['stream', BVID] }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ available: false, provider: 'Bilibili', code: 'short' });
    const [, , [, options]] = vi.mocked(fetch).mock.calls;
    expect(new Headers(options?.headers).get('range')).toBe('bytes=0-1');
  });

  it('proxies an approved full stream and forwards browser range requests', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch)
      .mockResolvedValueOnce(viewResponse())
      .mockResolvedValueOnce(playUrlResponse())
      .mockResolvedValueOnce(
        new Response('audio bytes', {
          status: 206,
          headers: {
            'content-type': 'application/octet-stream',
            'content-range': 'bytes 0-10/5000000',
            'content-length': '11',
            'accept-ranges': 'bytes',
          },
        }),
      );

    const response = await GET(request(`stream/${BVID}`, { range: 'bytes=0-10' }), {
      params: Promise.resolve({ path: ['stream', BVID] }),
    });

    expect(response.status).toBe(206);
    expect(response.headers.get('content-type')).toBe('audio/mp4');
    expect(response.headers.get('content-range')).toBe('bytes 0-10/5000000');
    expect(await response.text()).toBe('audio bytes');
    const [, options] = vi.mocked(fetch).mock.calls[2];
    expect(new Headers(options?.headers).get('range')).toBe('bytes=0-10');
  });

  it('does not fetch a media URL outside the Bilibili CDN allowlist', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch)
      .mockResolvedValueOnce(viewResponse())
      .mockResolvedValueOnce(playUrlResponse('https://example.com/audio.m4s'));

    const response = await GET(request(`stream/${BVID}?probe=1`), {
      params: Promise.resolve({ path: ['stream', BVID] }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ available: false, provider: 'Bilibili', code: 'unavailable' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
