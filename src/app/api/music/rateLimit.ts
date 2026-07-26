import { NextResponse } from 'next/server';

interface RateLimitEntry {
  count: number;
  expiresAt: number;
}

interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  maxEntries: number;
  now?: () => number;
}

function clientAddress(request: Request): string {
  const realIp = request.headers.get('x-real-ip')?.trim();
  const forwardedIp = request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim();
  const candidate = realIp || forwardedIp;

  // These headers must be overwritten by the deployment's trusted proxy.
  // Restricting the value also prevents attacker-controlled map keys.
  return candidate && /^[0-9a-f:.]{1,64}$/i.test(candidate) ? candidate.toLowerCase() : 'unknown';
}

export function createRateLimiter({
  windowMs,
  maxRequests,
  maxEntries,
  now = Date.now,
}: RateLimiterOptions): (request: Request, bucket: string) => NextResponse | null {
  const entries = new Map<string, RateLimitEntry>();

  return (request, bucket) => {
    const timestamp = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= timestamp) entries.delete(key);
    }

    const key = `${clientAddress(request)}\u0000${bucket}`;
    const current = entries.get(key);
    if (current && current.count >= maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((current.expiresAt - timestamp) / 1_000));
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      );
    }

    entries.set(
      key,
      current ? { ...current, count: current.count + 1 } : { count: 1, expiresAt: timestamp + windowMs },
    );

    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
    return null;
  };
}
