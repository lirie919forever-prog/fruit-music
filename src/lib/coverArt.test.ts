import { describe, expect, it } from 'vitest';
import { createDeterministicCover, safeCoverArt } from './coverArt';

describe('createDeterministicCover', () => {
  it('creates a deterministic UTF-8-safe SVG data URL', () => {
    const first = createDeterministicCover('中村あゆみ');
    const second = createDeterministicCover('中村あゆみ');

    expect(first).toBe(second);
    expect(first).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(decodeURIComponent(first.split(',')[1])).toContain('中');
  });

  it('rejects insecure remote artwork to avoid mixed content', () => {
    expect(safeCoverArt('http://images.example.test/cover.jpg')).toBe('/placeholder-album.svg');
    expect(safeCoverArt('javascript:alert(1)')).toBe('/placeholder-album.svg');
  });

  it('keeps HTTPS, local, and generated artwork', () => {
    expect(safeCoverArt('https://images.example.test/cover.jpg')).toBe('https://images.example.test/cover.jpg');
    expect(safeCoverArt('/placeholder-album.svg')).toBe('/placeholder-album.svg');
    expect(safeCoverArt('data:image/svg+xml;base64,abc')).toBe('data:image/svg+xml;base64,abc');
  });

  it('escapes XML-sensitive labels', () => {
    const uri = createDeterministicCover('<Artist>');
    expect(decodeURIComponent(uri.split(',')[1])).toContain('&lt;');
  });
});
