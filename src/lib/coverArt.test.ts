import { describe, expect, it } from 'vitest';
import { createDeterministicCover } from './coverArt';

describe('createDeterministicCover', () => {
  it('creates a deterministic UTF-8-safe SVG data URL', () => {
    const first = createDeterministicCover('中村あゆみ');
    const second = createDeterministicCover('中村あゆみ');

    expect(first).toBe(second);
    expect(first).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(decodeURIComponent(first.split(',')[1])).toContain('中');
  });

  it('escapes XML-sensitive labels', () => {
    const uri = createDeterministicCover('<Artist>');
    expect(decodeURIComponent(uri.split(',')[1])).toContain('&lt;');
  });
});
