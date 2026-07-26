import { describe, expect, it } from 'vitest';
import { getResumePosition, isNaturalTrackEnd } from './playbackRecovery';

describe('playback recovery', () => {
  it('recognizes a track that reaches its decoded duration', () => {
    expect(isNaturalTrackEnd(180, 180, 180)).toBe(true);
    expect(isNaturalTrackEnd(178.5, 180, 180)).toBe(true);
  });

  it('rejects a materially truncated track end', () => {
    expect(isNaturalTrackEnd(42, 180, 180)).toBe(false);
  });

  it('allows small provider duration differences', () => {
    expect(isNaturalTrackEnd(178, 180, 175)).toBe(true);
  });

  it('returns a safe resume position', () => {
    expect(getResumePosition(42, 180)).toBe(42);
    expect(getResumePosition(999, 180)).toBe(179.75);
    expect(getResumePosition(Number.NaN, 180)).toBe(0);
  });
});
