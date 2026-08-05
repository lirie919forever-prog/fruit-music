'use client';

import { useCallback, useSyncExternalStore } from 'react';

export interface PlaybackClockSnapshot {
  progress: number;
  songId: string | null;
}

const DEFAULT_SNAPSHOT: PlaybackClockSnapshot = { progress: 0, songId: null };
let snapshot = DEFAULT_SNAPSHOT;
const listeners = new Set<() => void>();

export function setPlaybackClock(progress: number, songId: string | null = snapshot.songId): void {
  const nextProgress = Number.isFinite(progress) && progress >= 0 ? progress : 0;
  if (snapshot.progress === nextProgress && snapshot.songId === songId) return;
  snapshot = { progress: nextProgress, songId };
  listeners.forEach((listener) => listener());
}

export function getPlaybackClockSnapshot(): PlaybackClockSnapshot {
  return snapshot;
}

export function subscribeToPlaybackClock(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePlaybackClock(): PlaybackClockSnapshot {
  return useSyncExternalStore(subscribeToPlaybackClock, getPlaybackClockSnapshot, () => DEFAULT_SNAPSHOT);
}

export function usePlaybackClockValue<T>(selector: (value: PlaybackClockSnapshot) => T, serverValue: T): T {
  const getSelectedSnapshot = useCallback(() => selector(snapshot), [selector]);
  const getServerSnapshot = useCallback(() => serverValue, [serverValue]);
  return useSyncExternalStore(subscribeToPlaybackClock, getSelectedSnapshot, getServerSnapshot);
}
