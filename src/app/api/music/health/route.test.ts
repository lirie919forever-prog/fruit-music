import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('music source health route', () => {
  it('returns readiness without exposing server configuration', async () => {
    vi.stubEnv('JAMENDO_CLIENT_ID', 'secret-jamendo-id');
    const response = await GET();
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(Array.isArray(body.sources)).toBe(true);
    expect(serialized).not.toContain('secret-jamendo-id');
    expect(body.sources.find((source: { name: string }) => source.name === 'Jamendo')).toMatchObject({
      readiness: 'ready',
    });
  });
});
