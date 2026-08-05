import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSourceHealth } from './sourceHealth';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('source readiness', () => {
  it('does not call unconfigured Jamendo or disabled LX connected', () => {
    const health = getSourceHealth();

    expect(health.find((source) => source.name === 'Jamendo')).toMatchObject({ readiness: 'setup-required' });
    expect(health.find((source) => source.name === 'LX Music')).toMatchObject({ readiness: 'disabled' });
    expect(health.find((source) => source.name === 'Audius')).toMatchObject({ readiness: 'ready' });
  });

  it('recognizes valid server configuration without returning the values', () => {
    vi.stubEnv('JAMENDO_CLIENT_ID', 'jamendo-test-id');
    vi.stubEnv('NEXT_PUBLIC_LX_ENABLED', 'true');
    vi.stubEnv('LX_API_BASE', 'https://reviewed.example.test');

    const health = getSourceHealth();
    const serialized = JSON.stringify(health);

    expect(health.find((source) => source.name === 'Jamendo')).toMatchObject({ readiness: 'ready' });
    expect(health.find((source) => source.name === 'LX Music')).toMatchObject({ readiness: 'ready' });
    expect(serialized).not.toContain('jamendo-test-id');
    expect(serialized).not.toContain('reviewed.example.test');
  });

  it('rejects an enabled LX integration without a valid HTTPS endpoint', () => {
    vi.stubEnv('NEXT_PUBLIC_LX_ENABLED', 'true');
    vi.stubEnv('LX_API_BASE', 'http://insecure.example.test');
    vi.stubEnv('LX_RESOLVER_BASE', 'https://user:pass@example.test:8443/#fragment');

    expect(getSourceHealth().find((source) => source.name === 'LX Music')).toMatchObject({
      readiness: 'setup-required',
    });
  });
});
