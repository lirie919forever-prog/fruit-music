import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rateLimit';

function request(ip: string): Request {
  return new Request('https://marea.test/api/music/jamendo/tracks', {
    headers: { 'x-forwarded-for': ip },
  });
}

describe('per-client rate limiting', () => {
  it("does not let one client exhaust another client's route bucket", () => {
    const rateLimit = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
      maxEntries: 10,
      now: () => 1_000,
    });

    expect(rateLimit(request('203.0.113.10'), 'jamendo:tracks')).toBeNull();
    const blocked = rateLimit(request('203.0.113.10'), 'jamendo:tracks');
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get('retry-after')).toBe('60');
    expect(rateLimit(request('203.0.113.11'), 'jamendo:tracks')).toBeNull();
  });

  it('keeps independent route buckets for the same client', () => {
    const rateLimit = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
      maxEntries: 10,
    });

    expect(rateLimit(request('203.0.113.10'), 'jamendo:tracks')).toBeNull();
    expect(rateLimit(request('203.0.113.10'), 'jamendo:albums')).toBeNull();
  });
});
