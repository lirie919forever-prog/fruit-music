import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSourceHealth } from './sourceHealthClient';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('source health client boundary', () => {
  it('accepts only normalized source readiness rows', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        sources: [
          { name: 'Audius', readiness: 'ready', detail: 'Public adapter enabled' },
          { name: 'Jamendo', readiness: 'setup-required', detail: 'Add JAMENDO_CLIENT_ID on the server' },
          { name: 'Ignored', readiness: 'unknown', detail: 'not a valid row' },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;

    await expect(fetchSourceHealth(signal)).resolves.toEqual([
      { name: 'Audius', readiness: 'ready', detail: 'Public adapter enabled' },
      { name: 'Jamendo', readiness: 'setup-required', detail: 'Add JAMENDO_CLIENT_ID on the server' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/api/music/health', { cache: 'no-store', signal });
  });

  it('fails closed for an HTTP error or an empty validated response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream failed', { status: 503 })),
    );
    await expect(fetchSourceHealth()).rejects.toThrow('Source status request failed');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ sources: [{ name: 'Audius', readiness: 'unknown', detail: 'bad' }] })),
    );
    await expect(fetchSourceHealth()).rejects.toThrow('Source status response was empty');
  });
});
