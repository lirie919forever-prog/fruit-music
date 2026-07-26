import { describe, expect, it } from 'vitest';
import { isProxiedArtwork } from './CoverArt';

describe('artwork retry targeting', () => {
  it('retries only artwork served through the image proxy', () => {
    expect(isProxiedArtwork('http://localhost:3000/api/images?url=https%3A%2F%2Fis1-ssl.mzstatic.com%2Fa.jpg')).toBe(true);
    expect(isProxiedArtwork('/api/images?url=https%3A%2F%2Fis1-ssl.mzstatic.com%2Fa.jpg')).toBe(true);
  });

  it('leaves the placeholder and generated covers alone', () => {
    // Both are same-origin, and neither carries a query string — appending
    // `&retry=1` to them would only produce a second failing request.
    expect(isProxiedArtwork('http://localhost:3000/placeholder-album.svg')).toBe(false);
    expect(isProxiedArtwork('data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E')).toBe(false);
    expect(isProxiedArtwork('https://is1-ssl.mzstatic.com/image/a/600x600bb.jpg')).toBe(false);
  });

  it('does not retry a URL that only looks like the proxy path', () => {
    expect(isProxiedArtwork('http://localhost:3000/api/images/extra?url=x')).toBe(false);
    expect(isProxiedArtwork('not a url at all')).toBe(false);
  });
});
