import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { providerFetch } from './errors';

beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('providerFetch', () => {
  it('passes the external signal and preserves external AbortError', async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    });

    await expect(providerFetch('Jamendo', 'tracks', '/api/music/jamendo/tracks', {}, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ signal: expect.any(AbortSignal) });
  });

  it('normalizes cancellation that races response parsing', async () => {
    const controller = new AbortController();
    const response = {
      ok: true,
      status: 200,
      json: vi.fn(async () => {
        controller.abort();
        throw new SyntaxError('body canceled');
      }),
    } as unknown as Response;
    vi.mocked(fetch).mockResolvedValue(response);

    await expect(providerFetch(
      'Jamendo',
      'tracks',
      '/api/music/jamendo/tracks',
      {},
      controller.signal
    )).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('keeps provider HTTP and invalid response classifications', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(providerFetch('Jamendo', 'tracks', '/api/music/jamendo/tracks')).rejects.toMatchObject({ code: 'not_configured', status: 503 });

    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 504 }));
    await expect(providerFetch('Jamendo', 'tracks', '/api/music/jamendo/tracks')).rejects.toMatchObject({ code: 'timeout', status: 504 });

    vi.mocked(fetch).mockResolvedValueOnce(new Response('not-json', { status: 200 }));
    await expect(providerFetch('Jamendo', 'tracks', '/api/music/jamendo/tracks')).rejects.toMatchObject({ code: 'invalid_response', status: 200 });
  });

  it('converts its own deadline into a timeout ProviderError', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));

    const request = providerFetch('Archive', 'tracks', '/api/music/archive/tracks');
    const result = expect(request).rejects.toMatchObject({ code: 'timeout', status: 504 });
    await vi.advanceTimersByTimeAsync(9_000);
    await result;
  });
});
