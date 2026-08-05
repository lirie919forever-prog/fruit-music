// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getPlaybackClockSnapshot, setPlaybackClock, usePlaybackClockValue } from './playbackClock';

describe('playback clock', () => {
  it('publishes frame-rate values without requiring the player store', () => {
    act(() => setPlaybackClock(0));
    const { result } = renderHook(() => usePlaybackClockValue((clock) => clock.progress, 0));
    expect(result.current).toBe(0);
    act(() => setPlaybackClock(12.5));
    expect(result.current).toBe(12.5);
    expect(getPlaybackClockSnapshot().progress).toBe(12.5);
    expect(getPlaybackClockSnapshot().songId).toBeNull();
    act(() => setPlaybackClock(0));
  });

  it('keeps the live position associated with the track that owns it', () => {
    act(() => setPlaybackClock(18, 'track-a'));
    expect(getPlaybackClockSnapshot()).toEqual({ progress: 18, songId: 'track-a' });
    act(() => setPlaybackClock(0, 'track-b'));
    expect(getPlaybackClockSnapshot()).toEqual({ progress: 0, songId: 'track-b' });
    act(() => setPlaybackClock(0, null));
  });
});
