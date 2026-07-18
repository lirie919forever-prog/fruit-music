import { describe, expect, it } from 'vitest';
import { getCategoryState } from './CategoryGrid';
import type { Song } from '@/types/music';

const song = { id: 'song-1' } as Song;

describe('getCategoryState', () => {
  it('retains available tracks and failed-provider metadata', () => {
    expect(getCategoryState({ results: [song], failedProviders: ['ccMixter'], providerCount: 2 })).toEqual({
      songs: [song],
      failedProviders: ['ccMixter'],
      totalFailure: false,
    });
  });

  it('identifies total federated failure separately from an empty category', () => {
    expect(getCategoryState({ results: [], failedProviders: ['Jamendo', 'ccMixter'], providerCount: 2 })).toEqual({
      songs: [],
      failedProviders: ['Jamendo', 'ccMixter'],
      totalFailure: true,
    });
    expect(getCategoryState([])).toEqual({ songs: [], failedProviders: [], totalFailure: false });
  });
});
