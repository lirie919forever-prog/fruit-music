import { describe, expect, it } from 'vitest';
import { shouldServeArtworkDirectly } from './CoverArt';

describe('artwork delivery', () => {
  it('serves validated remote artwork without the local image optimizer', () => {
    expect(shouldServeArtworkDirectly('https://is1-ssl.mzstatic.com/image/a/600x600bb.jpg')).toBe(true);
  });

  it('serves generated and fallback artwork directly', () => {
    expect(shouldServeArtworkDirectly('/placeholder-album.svg')).toBe(true);
    expect(shouldServeArtworkDirectly('data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E')).toBe(true);
  });

  it('keeps ordinary local raster artwork eligible for optimization', () => {
    expect(shouldServeArtworkDirectly('/covers/album.jpg')).toBe(false);
    expect(shouldServeArtworkDirectly('http://untrusted.example/album.jpg')).toBe(false);
  });
});
