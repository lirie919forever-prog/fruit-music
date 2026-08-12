import { describe, it, expect } from 'vitest';
import { normalizeCJK, TRAD_TO_SIMP, SHINJITAI_TO_SIMP } from './cjkNormalize';

const cp = (n: number) => String.fromCodePoint(n);

describe('normalizeCJK', () => {
  it('converts traditional kanji to simplified', () => {
    expect(normalizeCJK(cp(0x6a02))).toBe(cp(0x4e50));
  });

  it('converts JP shinjitai to PRC simplified (music)', () => {
    expect(normalizeCJK(cp(0x697d))).toBe(cp(0x4e50));
  });

  it('converts katakana to hiragana', () => {
    const kata = [0x30a2, 0x30a4, 0x30c9, 0x30eb].map(cp).join('');
    const hira = [0x3042, 0x3044, 0x3069, 0x308b].map(cp).join('');
    expect(normalizeCJK(kata)).toBe(hira);
  });

  it('recombines NFKD-decomposed dakuten then kana-normalizes', () => {
    expect(normalizeCJK(cp(0x30c8) + cp(0x3099))).toBe(cp(0x3069));
  });

  it('normalizes a mixed JP title to its simplified/hiragana store form', () => {
    expect(normalizeCJK(cp(0x97f3) + cp(0x697d))).toBe(cp(0x97f3) + cp(0x4e50));
  });

  it('keeps Latin/digit text intact', () => {
    expect(normalizeCJK('YOASOBI 2024')).toBe('YOASOBI 2024');
  });

  it('exposes non-trivial trad and shinjitai tables with no key overlap', () => {
    expect(Object.keys(TRAD_TO_SIMP).length).toBeGreaterThan(50);
    expect(Object.keys(SHINJITAI_TO_SIMP).length).toBeGreaterThan(5);
    const trad = new Set(Object.keys(TRAD_TO_SIMP));
    for (const k of Object.keys(SHINJITAI_TO_SIMP)) {
      expect(trad.has(k)).toBe(false);
    }
  });
});
