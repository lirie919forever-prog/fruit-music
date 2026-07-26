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

  it('keeps artwork from a provider host, local paths, and generated covers', () => {
    expect(safeCoverArt('https://usercontent.jamendo.com/cover.jpg')).toBe('https://usercontent.jamendo.com/cover.jpg');
    expect(safeCoverArt('/placeholder-album.svg')).toBe('/placeholder-album.svg');
    expect(safeCoverArt('data:image/svg+xml;base64,abc')).toBe('data:image/svg+xml;base64,abc');
  });

  it('falls back for an https host the image optimizer is not configured for', () => {
    // remotePatterns makes the optimizer answer an unlisted host with a 400,
    // which renders as a broken tile. Screening here turns that into the
    // placeholder instead — and the list is shared with the optimizer config
    // so the two cannot disagree about which hosts those are.
    expect(safeCoverArt('https://images.example.test/cover.jpg')).toBe('/placeholder-album.svg');
    expect(safeCoverArt('https://usercontent.jamendo.com.attacker.example/x.jpg')).toBe('/placeholder-album.svg');
  });

  it('escapes XML-sensitive labels', () => {
    const uri = createDeterministicCover('<Artist>');
    expect(decodeURIComponent(uri.split(',')[1])).toContain('&lt;');
  });
});
