'use client';

import { create } from 'zustand';
import type { Song, QueueItem, ViewType } from '@/types/music';

export interface TransportCommand {
  sequence: number;
  type: 'seek';
  position: number;
}

export type PlayerStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error';

interface PlayerState {
  currentSong: Song | null;
  activeSongId: string | null;
  queue: QueueItem[];
  queueIndex: number | null;
  isPlaying: boolean;
  playbackIntent: boolean;
  volume: number;
  lastNonZeroVolume: number;
  progress: number;
  duration: number;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  currentView: ViewType;
  status: PlayerStatus;
  error: string | null;
  transportCommand: TransportCommand | null;

  setCurrentSong: (song: Song) => void;
  setQueue: (songs: Song[], startIndex?: number) => void;
  playSong: (song: Song) => void;
  addToQueue: (song: Song) => void;
  removeFromQueue: (index: number) => void;
  playQueueIndex: (index: number) => void;
  next: () => void;
  previous: () => void;
  setEnginePlaying: (songId: string, playing: boolean) => void;
  setPlaybackIntent: (playing: boolean) => void;
  togglePlay: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setProgress: (progress: number) => void;
  setDuration: (duration: number) => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  setCurrentView: (view: ViewType) => void;
  setStatus: (status: PlayerStatus, error?: string | null) => void;
  playAlbum: (songs: Song[], startIndex?: number) => void;
}

function clampStartIndex(length: number, startIndex: number): number {
  if (length === 0 || !Number.isFinite(startIndex)) return 0;
  return Math.max(0, Math.min(length - 1, Math.trunc(startIndex)));
}

function queueState(songs: Song[], startIndex = 0) {
  if (songs.length === 0) {
    return {
      queue: [] as QueueItem[],
      queueIndex: null,
      currentSong: null,
      activeSongId: null,
      isPlaying: false,
      playbackIntent: false,
      progress: 0,
      duration: 0,
      status: 'idle' as PlayerStatus,
      error: null,
      transportCommand: null,
    };
  }

  const queue: QueueItem[] = songs.map((song) => ({ song, addedBy: 'user' }));
  const queueIndex = clampStartIndex(queue.length, startIndex);
  return {
    queue,
    queueIndex,
    currentSong: queue[queueIndex].song,
    activeSongId: null,
    isPlaying: false,
    playbackIntent: true,
    progress: 0,
    duration: 0,
    status: 'loading' as PlayerStatus,
    error: null,
    transportCommand: null,
  };
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentSong: null,
  activeSongId: null,
  queue: [],
  queueIndex: null,
  isPlaying: false,
  playbackIntent: false,
  volume: 0.7,
  lastNonZeroVolume: 0.7,
  progress: 0,
  duration: 0,
  shuffle: false,
  repeat: 'off',
  currentView: 'trending',
  status: 'idle',
  error: null,
  transportCommand: null,

  setCurrentSong: (song) => set(queueState([song])),
  setQueue: (songs, startIndex = 0) => set(queueState(songs, startIndex)),
  playSong: (song) => set({ ...queueState([song]), currentView: 'now-playing' }),
  addToQueue: (song) => set((state) => ({ queue: [...state.queue, { song, addedBy: 'user' }] })),
  removeFromQueue: (index) => {
    const { queue, queueIndex, playbackIntent } = get();
    if (index < 0 || index >= queue.length) return;

    const nextQueue = queue.filter((_, itemIndex) => itemIndex !== index);
    if (nextQueue.length === 0) {
      set(queueState([]));
      return;
    }

    if (queueIndex === null) {
      set({ queue: nextQueue });
      return;
    }

    let nextIndex = queueIndex;
    let sourceChanged = false;
    if (index < queueIndex) {
      nextIndex = queueIndex - 1;
    } else if (index === queueIndex) {
      nextIndex = Math.min(queueIndex, nextQueue.length - 1);
      sourceChanged = true;
    }

    set({
      queue: nextQueue,
      queueIndex: nextIndex,
      currentSong: nextQueue[nextIndex].song,
      ...(sourceChanged ? {
        progress: 0,
        duration: 0,
        activeSongId: null,
        isPlaying: false,
        playbackIntent,
        status: playbackIntent ? 'loading' as PlayerStatus : 'paused' as PlayerStatus,
        error: null,
        transportCommand: null,
      } : {}),
    });
  },

  playQueueIndex: (index) => {
    const { queue } = get();
    if (!Number.isInteger(index) || index < 0 || index >= queue.length) return;
    set({
      queueIndex: index,
      currentSong: queue[index].song,
      activeSongId: null,
      isPlaying: false,
      playbackIntent: true,
      progress: 0,
      duration: 0,
      status: 'loading',
      error: null,
      transportCommand: null,
      currentView: 'now-playing',
    });
  },

  next: () => {
    const { queue, queueIndex, shuffle, repeat } = get();
    if (queueIndex === null || queue.length === 0) return;

    let nextIndex: number;
    if (shuffle && queue.length > 1) {
      const candidate = Math.floor(Math.random() * (queue.length - 1));
      nextIndex = candidate >= queueIndex ? candidate + 1 : candidate;
    } else if (queueIndex < queue.length - 1) {
      nextIndex = queueIndex + 1;
    } else if (repeat === 'all') {
      nextIndex = 0;
    } else {
      set({ activeSongId: null, isPlaying: false, playbackIntent: false, status: 'paused' });
      return;
    }

    set({
      queueIndex: nextIndex,
      currentSong: queue[nextIndex].song,
      activeSongId: null,
      isPlaying: false,
      playbackIntent: true,
      progress: 0,
      duration: 0,
      status: 'loading',
      error: null,
      transportCommand: null,
    });
  },

  previous: () => {
    const { queue, queueIndex, progress, repeat, transportCommand } = get();
    if (queueIndex === null || queue.length === 0) return;

    if (progress > 3 || queueIndex === 0 && repeat !== 'all') {
      set({
        progress: 0,
        transportCommand: {
          sequence: (transportCommand?.sequence ?? 0) + 1,
          type: 'seek',
          position: 0,
        },
      });
      return;
    }

    const previousIndex = queueIndex > 0 ? queueIndex - 1 : queue.length - 1;
    set({
      queueIndex: previousIndex,
      currentSong: queue[previousIndex].song,
      activeSongId: null,
      isPlaying: false,
      playbackIntent: true,
      progress: 0,
      duration: 0,
      status: 'loading',
      error: null,
      transportCommand: null,
    });
  },

  setEnginePlaying: (songId, playing) => set((state) => {
    if (!state.currentSong || state.currentSong.id !== songId) return {};
    if (playing) {
      return {
        activeSongId: songId,
        isPlaying: true,
        status: 'playing' as PlayerStatus,
        error: null,
      };
    }
    return {
      activeSongId: null,
      isPlaying: false,
      status: state.status === 'error' ? 'error' as PlayerStatus : 'paused' as PlayerStatus,
    };
  }),
  setPlaybackIntent: (playing) => set((state) => state.currentSong
    ? {
        playbackIntent: playing,
        ...(!playing ? {
          activeSongId: null,
          isPlaying: false,
          status: state.status === 'error' ? 'error' as PlayerStatus : 'paused' as PlayerStatus,
        } : {}),
      }
    : { activeSongId: null, isPlaying: false, playbackIntent: false, status: 'idle' }),
  togglePlay: () => set((state) => {
    if (!state.currentSong) return { activeSongId: null, isPlaying: false, playbackIntent: false, status: 'idle' as PlayerStatus };
    const playbackIntent = !state.playbackIntent;
    return {
      playbackIntent,
      ...(!playbackIntent ? { activeSongId: null, isPlaying: false } : {}),
      status: playbackIntent
        ? (state.status === 'error' ? 'loading' : state.status)
        : 'paused',
      error: playbackIntent ? null : state.error,
    };
  }),
  setVolume: (volume) => set((state) => {
    const nextVolume = Math.max(0, Math.min(1, volume));
    return {
      volume: nextVolume,
      lastNonZeroVolume: nextVolume > 0 ? nextVolume : state.lastNonZeroVolume,
    };
  }),
  toggleMute: () => set((state) => state.volume > 0
    ? { volume: 0, lastNonZeroVolume: state.volume }
    : { volume: state.lastNonZeroVolume || 0.7 }),
  setProgress: (progress) => set({ progress }),
  setDuration: (duration) => set({ duration }),
  toggleShuffle: () => set((state) => state.currentSong ? { shuffle: !state.shuffle } : {}),
  toggleRepeat: () => set((state) => {
    if (!state.currentSong) return {};
    const modes: PlayerState['repeat'][] = ['off', 'all', 'one'];
    return { repeat: modes[(modes.indexOf(state.repeat) + 1) % modes.length] };
  }),
  setCurrentView: (view) => set({ currentView: view }),
  setStatus: (status, error = null) => set({
    status,
    error,
    ...(status === 'error' || status === 'idle' ? { activeSongId: null, isPlaying: false, playbackIntent: false } : {}),
  }),

  playAlbum: (songs, startIndex = 0) => set({ ...queueState(songs, startIndex), currentView: 'now-playing' }),
}));
