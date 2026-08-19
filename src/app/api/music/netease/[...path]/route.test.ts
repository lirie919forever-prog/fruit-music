import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadRoute() {
  vi.resetModules();
  return (await import('./route')).GET;
}

function request(path: string, headers?: HeadersInit): Request {
  return new Request(`http://localhost/api/music/netease/${path}`, { headers });
}

function audioResponse(totalBytes: number, body = 'audio'): Response {
  return new Response(body, {
    status: 206,
    headers: {
      'content-type': 'audio/mpeg',
      'content-range': `bytes 0-${Math.max(0, body.length - 1)}/${totalBytes}`,
      'content-length': String(body.length),
      'accept-ranges': 'bytes',
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

describe('Netease API route', () => {
  it('rejects trial-sized audio when a full recording duration is expected', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch)
      .mockResolvedValueOnce(audioResponse(481_115, 'xx'))
      .mockResolvedValueOnce(audioResponse(481_115, 'xx'));

    const response = await GET(request('stream/2745026895?probe=1&expected=152'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ available: false });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get('range')).toBe('bytes=0-1');
  });

  it('falls back to an approved full recording when the first stream is too short', async () => {
    const GET = await loadRoute();
    vi.mocked(fetch)
      .mockResolvedValueOnce(audioResponse(481_115, 'xx'))
      .mockResolvedValueOnce(audioResponse(912_000, 'audio'));

    const response = await GET(request('stream/2745026895?expected=152', { range: 'bytes=0-4' }));

    expect(response.status).toBe(206);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(await response.text()).toBe('audio');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(new Headers(vi.mocked(fetch).mock.calls[1][1]?.headers).get('range')).toBe('bytes=0-4');
  });
});
