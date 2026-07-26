import { describe, expect, it } from 'vitest';
import { isOptimizedArtwork } from './CoverArt';

describe('artwork retry targeting', () => {
  it('retries only artwork served through the image proxy', () => {
    expect(isOptimizedArtwork('http://localhost:3000/_next/image?url=https%3A%2F%2Fis1-ssl.mzstatic.com%2Fa.jpg')).toBe(true);
    expect(isOptimizedArtwork('/_next/image?url=https%3A%2F%2Fis1-ssl.mzstatic.com%2Fa.jpg')).toBe(true);
  });

  it('leaves the placeholder and generated covers alone', () => {
    // Both are same-origin, and neither carries a query string — appending
    // `&retry=1` to them would only produce a second failing request.
    expect(isOptimizedArtwork('http://localhost:3000/placeholder-album.svg')).toBe(false);
    expect(isOptimizedArtwork('data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E')).toBe(false);
    expect(isOptimizedArtwork('https://is1-ssl.mzstatic.com/image/a/600x600bb.jpg')).toBe(false);
  });

  it('does not retry a URL that only looks like the proxy path', () => {
    expect(isOptimizedArtwork('http://localhost:3000/_next/image/extra?url=x')).toBe(false);
    expect(isOptimizedArtwork('not a url at all')).toBe(false);
  });
});
