import { describe, expect, it } from 'vitest';
import { getResumePosition, hasNextInQueue, isNaturalTrackEnd } from './playbackRecovery';
import type { QueueItem, Song } from '@/types/music';

function queueOf(length: number): QueueItem[] {
  return Array.from({ length }, (_, index) => ({
    song: { id: `song-${index}` } as Song,
    addedBy: 'user' as const,
  }));
}

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

  it('reports no next track for an empty or unpositioned queue', () => {
    expect(hasNextInQueue({ queue: [], queueIndex: null, shuffle: false, repeat: 'off' })).toBe(false);
    expect(hasNextInQueue({ queue: queueOf(3), queueIndex: null, shuffle: false, repeat: 'off' })).toBe(false);
  });

  it('reports no next track at the end of a non-repeating, non-shuffled queue', () => {
    expect(hasNextInQueue({ queue: queueOf(3), queueIndex: 2, shuffle: false, repeat: 'off' })).toBe(false);
  });

  it('reports a next track mid-queue regardless of shuffle or repeat', () => {
    expect(hasNextInQueue({ queue: queueOf(3), queueIndex: 0, shuffle: false, repeat: 'off' })).toBe(true);
  });

  it('reports a next track at the end when repeat is all', () => {
    expect(hasNextInQueue({ queue: queueOf(3), queueIndex: 2, shuffle: false, repeat: 'all' })).toBe(true);
  });

  it('reports a next track at the end when shuffle can pick another track', () => {
    expect(hasNextInQueue({ queue: queueOf(3), queueIndex: 2, shuffle: true, repeat: 'off' })).toBe(true);
  });

  it('reports no next track when shuffle has only one track to shuffle within', () => {
    expect(hasNextInQueue({ queue: queueOf(1), queueIndex: 0, shuffle: true, repeat: 'off' })).toBe(false);
  });
});
