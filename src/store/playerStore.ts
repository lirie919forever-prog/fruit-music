'use client';

import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { Playlist, Song, QueueItem, ViewType } from '@/types/music';

export interface TransportCommand {
  sequence: number;
  type: 'seek';
  position: number;
}

export type PlayerStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error';

export interface PlayerState {
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
  searchQuery: string;
  status: PlayerStatus;
  error: string | null;
  transportCommand: TransportCommand | null;
  favorites: Song[];
  history: Song[];
  playlists: Playlist[];

  setCurrentSong: (song: Song) => void;
  setQueue: (songs: Song[], startIndex?: number) => void;
  playSong: (song: Song) => void;
  addToQueue: (song: Song) => void;
  playNext: (song: Song) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
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
  toggleFavorite: (song: Song) => void;
  clearHistory: () => void;
  setCurrentView: (view: ViewType) => void;
  setSearchQuery: (query: string) => void;
  setStatus: (status: PlayerStatus, error?: string | null) => void;
  playAlbum: (songs: Song[], startIndex?: number) => void;
  createPlaylist: (name: string, songs?: Song[]) => string | null;
  renamePlaylist: (playlistId: string, name: string) => void;
  deletePlaylist: (playlistId: string) => void;
  addToPlaylist: (playlistId: string, song: Song) => void;
  removeFromPlaylist: (playlistId: string, songId: string) => void;
  reorderPlaylist: (playlistId: string, fromIndex: number, toIndex: number) => void;
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

let playlistCounter = 0;

/**
 * Playlist ids only need to be unique within one browser's storage.
 * `crypto.randomUUID` is unavailable on insecure origins, so a timestamped
 * counter backs it up rather than letting playlist creation throw.
 */
function newPlaylistId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  playlistCounter += 1;
  return `playlist-${Date.now()}-${playlistCounter}`;
}

function dedupeById(songs: Song[]): Song[] {
  const seen = new Set<string>();
  return songs.filter((song) => seen.has(song.id) ? false : (seen.add(song.id), true));
}

const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

/**
 * Storage that refuses to write until rehydration has finished.
 *
 * `skipHydration` defers loading to an effect in PlayerStoreProvider, but React
 * runs child effects before parent ones — so the audio engine's `setStatus` and
 * the view/URL sync both fire first, and persist middleware wrote the empty
 * initial state over the saved one before it was ever read back. Favourites,
 * history, playlists and volume were silently cleared on every reload.
 *
 * Blocking writes until `allowWrites` closes that window. A change made in the
 * few milliseconds before hydration is not persisted, but hydration overwrites
 * it in memory anyway, so nothing observable is lost.
 */
function createGuardedStorage(): { storage: StateStorage; allowWrites: () => void } {
  let writable = false;
  return {
    allowWrites: () => { writable = true; },
    storage: {
      getItem: (name) => window.localStorage.getItem(name),
      setItem: (name, value) => { if (writable) window.localStorage.setItem(name, value); },
      removeItem: (name) => { if (writable) window.localStorage.removeItem(name); },
    },
  };
}

export function createPlayerStore(initialView: ViewType = 'albums', initialQuery = '') {
  const persistence = typeof window === 'undefined'
    ? { storage: noopStorage, allowWrites: () => {} }
    : createGuardedStorage();

  return createStore<PlayerState>()(persist((set, get) => ({
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
  currentView: initialView,
  searchQuery: initialView === 'search' ? initialQuery : '',
  status: 'idle',
  error: null,
  transportCommand: null,
  favorites: [],
  history: [],
  playlists: [],

  setCurrentSong: (song) => set(queueState([song])),
  setQueue: (songs, startIndex = 0) => set(queueState(songs, startIndex)),
  playSong: (song) => set(queueState([song])),
  addToQueue: (song) => set((state) => ({ queue: [...state.queue, { song, addedBy: 'user' }] })),
  playNext: (song) => set((state) => {
    const insertAt = state.queueIndex === null ? state.queue.length : state.queueIndex + 1;
    const queue = [...state.queue];
    queue.splice(insertAt, 0, { song, addedBy: 'user' });
    return { queue };
  }),
  clearQueue: () => set((state) => {
    if (state.queueIndex === null || !state.currentSong) return queueState([]);
    const current = state.queue[state.queueIndex];
    return {
      queue: current ? [current] : [],
      queueIndex: current ? 0 : null,
      currentSong: current?.song ?? null,
    };
  }),
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

  reorderQueue: (fromIndex, toIndex) => {
    const { queue, queueIndex } = get();
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex < 0 || toIndex < 0 || fromIndex >= queue.length || toIndex >= queue.length || fromIndex === toIndex) return;

    const nextQueue = [...queue];
    const [movedItem] = nextQueue.splice(fromIndex, 1);
    nextQueue.splice(toIndex, 0, movedItem);

    let nextIndex = queueIndex;
    if (queueIndex !== null) {
      if (fromIndex === queueIndex) nextIndex = toIndex;
      else if (fromIndex < queueIndex && toIndex >= queueIndex) nextIndex = queueIndex - 1;
      else if (fromIndex > queueIndex && toIndex <= queueIndex) nextIndex = queueIndex + 1;
    }

    set({ queue: nextQueue, queueIndex: nextIndex });
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
      if (!state.playbackIntent) return {};
      const history = [
        state.currentSong,
        ...state.history.filter((song) => song.id !== songId),
      ].slice(0, 30);
      return {
        activeSongId: songId,
        isPlaying: true,
        status: 'playing' as PlayerStatus,
        error: null,
        history,
      };
    }
    if (state.activeSongId !== songId) return {};
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
  toggleFavorite: (song) => set((state) => {
    const isFavorite = state.favorites.some((item) => item.id === song.id);
    return {
      favorites: isFavorite
        ? state.favorites.filter((item) => item.id !== song.id)
        : [song, ...state.favorites],
    };
  }),
  clearHistory: () => set({ history: [] }),
  setCurrentView: (view) => set({ currentView: view, ...(view === 'search' ? {} : { searchQuery: '' }) }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setStatus: (status, error = null) => set({
    status,
    error,
    ...(status === 'error' || status === 'idle' ? { activeSongId: null, isPlaying: false, playbackIntent: false } : {}),
  }),

  playAlbum: (songs, startIndex = 0) => set(queueState(songs, startIndex)),

  createPlaylist: (name, songs = []) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const id = newPlaylistId();
    set((state) => ({
      playlists: [{ id, name: trimmed, songs: dedupeById(songs), createdAt: Date.now() }, ...state.playlists],
    }));
    return id;
  },
  renamePlaylist: (playlistId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((state) => ({
      playlists: state.playlists.map((playlist) => playlist.id === playlistId ? { ...playlist, name: trimmed } : playlist),
    }));
  },
  deletePlaylist: (playlistId) => set((state) => ({
    playlists: state.playlists.filter((playlist) => playlist.id !== playlistId),
  })),
  // Adding a track twice is treated as a no-op rather than a duplicate row: the
  // control lives in a menu that is easy to hit twice, and a playlist holding
  // the same track back to back is never what was meant.
  addToPlaylist: (playlistId, song) => set((state) => ({
    playlists: state.playlists.map((playlist) => playlist.id !== playlistId || playlist.songs.some((item) => item.id === song.id)
      ? playlist
      : { ...playlist, songs: [...playlist.songs, song] }),
  })),
  removeFromPlaylist: (playlistId, songId) => set((state) => ({
    playlists: state.playlists.map((playlist) => playlist.id === playlistId
      ? { ...playlist, songs: playlist.songs.filter((song) => song.id !== songId) }
      : playlist),
  })),
  reorderPlaylist: (playlistId, fromIndex, toIndex) => set((state) => ({
    playlists: state.playlists.map((playlist) => {
      if (playlist.id !== playlistId) return playlist;
      const { songs } = playlist;
      if (
        !Number.isInteger(fromIndex) || !Number.isInteger(toIndex) ||
        fromIndex < 0 || toIndex < 0 ||
        fromIndex >= songs.length || toIndex >= songs.length ||
        fromIndex === toIndex
      ) {
        return playlist;
      }
      const nextSongs = [...songs];
      const [moved] = nextSongs.splice(fromIndex, 1);
      nextSongs.splice(toIndex, 0, moved);
      return { ...playlist, songs: nextSongs };
    }),
  })),
  }), {
    name: 'marea-player-v1',
    storage: createJSONStorage(() => persistence.storage),
    skipHydration: true,
    version: 1,
    // Fires once rehydration settles, which is the only point at which writing
    // the store back is safe. Runs on success and on failure alike: a corrupt
    // payload should not leave the app unable to save anything afterwards.
    onRehydrateStorage: () => () => persistence.allowWrites(),
    partialize: (state) => ({
      favorites: state.favorites,
      history: state.history,
      playlists: state.playlists,
      volume: state.volume,
      lastNonZeroVolume: state.lastNonZeroVolume,
      shuffle: state.shuffle,
      repeat: state.repeat,
    }),
  }));
}

export const playerStore = createPlayerStore();

const PlayerStoreContext = createContext<StoreApi<PlayerState> | null>(null);

export function PlayerStoreProvider({ initialView, initialQuery, children }: { initialView: ViewType; initialQuery: string; children: ReactNode }) {
  const [store] = useState(() => createPlayerStore(initialView, initialQuery));
  useEffect(() => {
    void store.persist.rehydrate();
  }, [store]);
  return createElement(PlayerStoreContext.Provider, { value: store }, children);
}

export function usePlayerStoreApi(): StoreApi<PlayerState> {
  return useContext(PlayerStoreContext) ?? playerStore;
}

export type PlayerStoreHook = {
  <T>(selector: (state: PlayerState) => T): T;
  getState: StoreApi<PlayerState>['getState'];
  setState: StoreApi<PlayerState>['setState'];
  subscribe: StoreApi<PlayerState>['subscribe'];
};

export const usePlayerStore = (<T>(selector: (state: PlayerState) => T): T => {
  return useStore(usePlayerStoreApi(), selector);
}) as PlayerStoreHook;

usePlayerStore.getState = playerStore.getState;
usePlayerStore.setState = playerStore.setState;
usePlayerStore.subscribe = playerStore.subscribe;
