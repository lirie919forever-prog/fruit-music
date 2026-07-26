'use client';

import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { isSong } from '@/lib/songShape';
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
  /**
   * The order shuffled playback walks: a permutation of every queue index,
   * generated once per queue rather than re-rolled on each `next`. Rolling per
   * track meant a five-track queue could repeat the same song three times
   * running and never reach one of the others at all.
   */
  shuffleOrder: number[];
  /** Queue indexes actually played, so `previous` can retrace a shuffled path. */
  playedIndexes: number[];
  repeat: 'off' | 'all' | 'one';
  currentView: ViewType;
  searchQuery: string;
  status: PlayerStatus;
  error: string | null;
  transportCommand: TransportCommand | null;
  favorites: Song[];
  history: Song[];
  playlists: Playlist[];
  /**
   * When playback should stop by itself, as a wall-clock time rather than a
   * remaining duration: a countdown held as a number would have to be ticked
   * down by something, and whatever ticked it would be wrong every time the
   * tab was backgrounded and its timers throttled.
   *
   * Deliberately not persisted — a sleep timer that outlived the page it was
   * set on would pause a session started hours later for no visible reason.
   */
  sleepTimerEndsAt: number | null;

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
  /** Minutes from now, or `null` to cancel. */
  setSleepTimer: (minutes: number | null) => void;
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

/** How far back `previous` can retrace. Matches the visible history length. */
const MAX_PLAYED_HISTORY = 30;

/**
 * A shuffled walk over every queue index, with `startIndex` pinned to the
 * front so the track already playing stays where it is.
 *
 * Fisher-Yates over the whole bag rather than a random pick per step: picking
 * each time is sampling with replacement, which repeats tracks and leaves
 * others unreached. Drawing an order up front guarantees each track plays once
 * per lap.
 */
export function buildShuffleOrder(length: number, startIndex: number): number[] {
  if (length <= 0) return [];
  const rest = Array.from({ length }, (_, index) => index).filter((index) => index !== startIndex);
  for (let index = rest.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [rest[index], rest[swap]] = [rest[swap], rest[index]];
  }
  return [startIndex, ...rest];
}

/**
 * Accepts an order only if it is still a permutation of the current queue.
 * Anything that touched the queue invalidates it, and a stale order would
 * either skip tracks or index past the end.
 */
export function validShuffleOrder(order: number[], length: number): number[] | null {
  if (order.length !== length) return null;
  const seen = new Set(order);
  return seen.size === length && order.every((index) => Number.isInteger(index) && index >= 0 && index < length)
    ? order
    : null;
}

function rememberPlayed(played: number[], index: number): number[] {
  return [...played, index].slice(-MAX_PLAYED_HISTORY);
}

function queueState(songs: Song[], startIndex = 0) {
  if (songs.length === 0) {
    return {
      queue: [] as QueueItem[],
      queueIndex: null,
      shuffleOrder: [] as number[],
      playedIndexes: [] as number[],
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
    // A new queue invalidates any previous walk through the old one.
    shuffleOrder: [] as number[],
    playedIndexes: [] as number[],
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
  return songs.filter((song) => (seen.has(song.id) ? false : (seen.add(song.id), true)));
}

const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export const PERSIST_VERSION = 1;
export const PERSIST_KEY = 'marea-player-v1';
/**
 * How long the write guard waits for rehydration before giving up on it.
 *
 * Blocking writes forever is worse than persisting slightly early: if
 * `onRehydrateStorage` never fires — storage disabled mid-session, a throw
 * inside the persist middleware — the user's favourites would silently stop
 * saving for the rest of the session with nothing to show for it.
 */
const REHYDRATE_TIMEOUT_MS = 5_000;

function isPlaylist(value: unknown): value is Playlist {
  if (typeof value !== 'object' || value === null) return false;
  const playlist = value as Record<string, unknown>;
  return (
    typeof playlist.id === 'string' &&
    playlist.id !== '' &&
    typeof playlist.name === 'string' &&
    typeof playlist.createdAt === 'number' &&
    Array.isArray(playlist.songs)
  );
}

function songList(value: unknown): Song[] | undefined {
  return Array.isArray(value) ? value.filter(isSong) : undefined;
}

function boundedVolume(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined;
}

/**
 * Filters a stored payload down to the parts that are still the shape this
 * version expects.
 *
 * A truncated write, a hand-edited value or a payload from an older build all
 * arrive here as `unknown`, and the store hands them straight to render. One
 * malformed favourite used to be enough to throw inside a list. Bad entries are
 * dropped individually so a single corrupt track does not cost the whole
 * library, and a field that fails entirely simply falls back to its default.
 */
export function sanitizePersistedState(value: unknown): Partial<PlayerState> {
  if (typeof value !== 'object' || value === null) return {};
  const raw = value as Record<string, unknown>;
  const playlists = Array.isArray(raw.playlists)
    ? raw.playlists
        .filter(isPlaylist)
        .map((playlist) => ({ ...playlist, songs: dedupeById((playlist.songs as unknown[]).filter(isSong)) }))
    : undefined;

  return {
    ...(songList(raw.favorites) ? { favorites: dedupeById(songList(raw.favorites)!) } : {}),
    ...(songList(raw.history) ? { history: dedupeById(songList(raw.history)!) } : {}),
    ...(playlists ? { playlists } : {}),
    ...(boundedVolume(raw.volume) !== undefined ? { volume: boundedVolume(raw.volume) } : {}),
    ...(boundedVolume(raw.lastNonZeroVolume) ? { lastNonZeroVolume: boundedVolume(raw.lastNonZeroVolume) } : {}),
    ...(typeof raw.shuffle === 'boolean' ? { shuffle: raw.shuffle } : {}),
    ...(raw.repeat === 'off' || raw.repeat === 'all' || raw.repeat === 'one' ? { repeat: raw.repeat } : {}),
  };
}

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
export function createGuardedStorage(
  backing: () => Storage,
  timeoutMs = REHYDRATE_TIMEOUT_MS,
): { storage: StateStorage; allowWrites: () => void; dispose: () => void } {
  let writable = false;
  const failOpen = setTimeout(() => {
    if (writable) return;
    writable = true;
    console.warn('[marea] rehydration did not settle; persisting anyway so changes are not silently dropped.');
  }, timeoutMs);
  // Node's timer would otherwise hold a test process open for the full timeout.
  failOpen.unref?.();

  const allowWrites = () => {
    writable = true;
    clearTimeout(failOpen);
  };

  return {
    allowWrites,
    dispose: () => clearTimeout(failOpen),
    storage: {
      getItem: (name) => {
        // Storage access itself throws when cookies are blocked, which must
        // read as "nothing saved", not as a failure to start.
        try {
          return backing().getItem(name);
        } catch {
          return null;
        }
      },
      setItem: (name, value) => {
        if (!writable) return;
        try {
          backing().setItem(name, value);
        } catch (error) {
          // A full quota is the common case and there is nothing useful to do
          // about it here: the in-memory state is still correct, and throwing
          // would surface inside whatever action happened to trip the limit.
          const quotaExceeded =
            error instanceof Error &&
            (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
          console.warn(
            quotaExceeded
              ? '[marea] local storage is full; this change was not saved.'
              : '[marea] could not write to local storage; this change was not saved.',
          );
        }
      },
      removeItem: (name) => {
        if (!writable) return;
        try {
          backing().removeItem(name);
        } catch {
          // Same reasoning as `setItem`: nothing actionable, nothing to break.
        }
      },
    },
  };
}

export function createPlayerStore(initialView: ViewType = 'albums', initialQuery = '') {
  const persistence =
    typeof window === 'undefined'
      ? { storage: noopStorage, allowWrites: () => {}, dispose: () => {} }
      : createGuardedStorage(() => window.localStorage);

  return createStore<PlayerState>()(
    persist(
      (set, get) => ({
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
        shuffleOrder: [],
        playedIndexes: [],
        repeat: 'off',
        currentView: initialView,
        searchQuery: initialView === 'search' ? initialQuery : '',
        status: 'idle',
        error: null,
        transportCommand: null,
        favorites: [],
        history: [],
        playlists: [],
        sleepTimerEndsAt: null,

        setCurrentSong: (song) => set(queueState([song])),
        setQueue: (songs, startIndex = 0) => set(queueState(songs, startIndex)),
        playSong: (song) => set(queueState([song])),
        addToQueue: (song) =>
          set((state) => ({ queue: [...state.queue, { song, addedBy: 'user' }], shuffleOrder: [] })),
        playNext: (song) =>
          set((state) => {
            const insertAt = state.queueIndex === null ? state.queue.length : state.queueIndex + 1;
            const queue = [...state.queue];
            queue.splice(insertAt, 0, { song, addedBy: 'user' });
            return { queue, shuffleOrder: [] };
          }),
        clearQueue: () =>
          set((state) => {
            if (state.queueIndex === null || !state.currentSong) return queueState([]);
            const current = state.queue[state.queueIndex];
            return {
              queue: current ? [current] : [],
              queueIndex: current ? 0 : null,
              shuffleOrder: [],
              playedIndexes: [],
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
            set({ queue: nextQueue, shuffleOrder: [], playedIndexes: [] });
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
            // The indexes in a shuffle order refer to positions that just moved.
            shuffleOrder: [],
            playedIndexes: [],
            currentSong: nextQueue[nextIndex].song,
            ...(sourceChanged
              ? {
                  progress: 0,
                  duration: 0,
                  activeSongId: null,
                  isPlaying: false,
                  playbackIntent,
                  status: playbackIntent ? ('loading' as PlayerStatus) : ('paused' as PlayerStatus),
                  error: null,
                  transportCommand: null,
                }
              : {}),
          });
        },

        reorderQueue: (fromIndex, toIndex) => {
          const { queue, queueIndex } = get();
          if (
            !Number.isInteger(fromIndex) ||
            !Number.isInteger(toIndex) ||
            fromIndex < 0 ||
            toIndex < 0 ||
            fromIndex >= queue.length ||
            toIndex >= queue.length ||
            fromIndex === toIndex
          )
            return;

          const nextQueue = [...queue];
          const [movedItem] = nextQueue.splice(fromIndex, 1);
          nextQueue.splice(toIndex, 0, movedItem);

          let nextIndex = queueIndex;
          if (queueIndex !== null) {
            if (fromIndex === queueIndex) nextIndex = toIndex;
            else if (fromIndex < queueIndex && toIndex >= queueIndex) nextIndex = queueIndex - 1;
            else if (fromIndex > queueIndex && toIndex <= queueIndex) nextIndex = queueIndex + 1;
          }

          set({ queue: nextQueue, queueIndex: nextIndex, shuffleOrder: [], playedIndexes: [] });
        },

        playQueueIndex: (index) => {
          const { queue } = get();
          if (!Number.isInteger(index) || index < 0 || index >= queue.length) return;
          const { queueIndex: fromIndex, playedIndexes } = get();
          set({
            playedIndexes: fromIndex === null ? playedIndexes : rememberPlayed(playedIndexes, fromIndex),
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
          const { queue, queueIndex, shuffle, repeat, shuffleOrder } = get();
          if (queueIndex === null || queue.length === 0) return;

          let nextIndex: number;
          let nextOrder = shuffleOrder;
          if (shuffle && queue.length > 1) {
            const order = validShuffleOrder(shuffleOrder, queue.length) ?? buildShuffleOrder(queue.length, queueIndex);
            const position = order.indexOf(queueIndex);
            if (position < order.length - 1) {
              nextIndex = order[position + 1];
              nextOrder = order;
            } else if (repeat === 'all') {
              // A fresh order for the new lap, still starting after the track that
              // just finished, so the loop point is not always the same pair.
              nextOrder = buildShuffleOrder(queue.length, queueIndex);
              nextIndex = nextOrder[1] ?? nextOrder[0];
            } else {
              set({ activeSongId: null, isPlaying: false, playbackIntent: false, status: 'paused' });
              return;
            }
          } else if (queueIndex < queue.length - 1) {
            nextIndex = queueIndex + 1;
          } else if (repeat === 'all') {
            nextIndex = 0;
          } else {
            set({ activeSongId: null, isPlaying: false, playbackIntent: false, status: 'paused' });
            return;
          }

          set({
            shuffleOrder: nextOrder,
            playedIndexes: rememberPlayed(get().playedIndexes, queueIndex),
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
          const { queue, queueIndex, progress, repeat, transportCommand, playedIndexes } = get();
          if (queueIndex === null || queue.length === 0) return;

          // What "previous" means depends on whether the order was shuffled: in
          // order, it is the track above; shuffled, the only useful answer is the
          // track you actually just heard, which the queue position cannot tell you.
          const played = playedIndexes.filter((index) => index >= 0 && index < queue.length);
          const previousPlayed = played.length > 0 ? played[played.length - 1] : null;
          const atStart = previousPlayed === null && queueIndex === 0;

          if (progress > 3 || (atStart && repeat !== 'all')) {
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

          const previousIndex = previousPlayed ?? (queueIndex > 0 ? queueIndex - 1 : queue.length - 1);
          set({
            playedIndexes: played.slice(0, -1),
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

        setEnginePlaying: (songId, playing) =>
          set((state) => {
            if (!state.currentSong || state.currentSong.id !== songId) return {};
            if (playing) {
              if (!state.playbackIntent) return {};
              const history = [state.currentSong, ...state.history.filter((song) => song.id !== songId)].slice(0, 30);
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
              status: state.status === 'error' ? ('error' as PlayerStatus) : ('paused' as PlayerStatus),
            };
          }),
        setPlaybackIntent: (playing) =>
          set((state) =>
            state.currentSong
              ? {
                  playbackIntent: playing,
                  ...(!playing
                    ? {
                        activeSongId: null,
                        isPlaying: false,
                        status: state.status === 'error' ? ('error' as PlayerStatus) : ('paused' as PlayerStatus),
                      }
                    : {}),
                }
              : { activeSongId: null, isPlaying: false, playbackIntent: false, status: 'idle' },
          ),
        togglePlay: () =>
          set((state) => {
            if (!state.currentSong)
              return { activeSongId: null, isPlaying: false, playbackIntent: false, status: 'idle' as PlayerStatus };
            const playbackIntent = !state.playbackIntent;
            return {
              playbackIntent,
              ...(!playbackIntent ? { activeSongId: null, isPlaying: false } : {}),
              status: playbackIntent ? (state.status === 'error' ? 'loading' : state.status) : 'paused',
              error: playbackIntent ? null : state.error,
            };
          }),
        setVolume: (volume) =>
          set((state) => {
            const nextVolume = Math.max(0, Math.min(1, volume));
            return {
              volume: nextVolume,
              lastNonZeroVolume: nextVolume > 0 ? nextVolume : state.lastNonZeroVolume,
            };
          }),
        toggleMute: () =>
          set((state) =>
            state.volume > 0
              ? { volume: 0, lastNonZeroVolume: state.volume }
              : { volume: state.lastNonZeroVolume || 0.7 },
          ),
        setProgress: (progress) => set({ progress }),
        setDuration: (duration) => set({ duration }),
        toggleShuffle: () =>
          set((state) => {
            if (!state.currentSong) return {};
            const shuffle = !state.shuffle;
            // Drawn on the way in rather than lazily on the first `next`, so the order
            // is fixed the moment the user asks for it.
            return {
              shuffle,
              shuffleOrder:
                shuffle && state.queueIndex !== null ? buildShuffleOrder(state.queue.length, state.queueIndex) : [],
            };
          }),
        toggleRepeat: () =>
          set((state) => {
            if (!state.currentSong) return {};
            const modes: PlayerState['repeat'][] = ['off', 'all', 'one'];
            return { repeat: modes[(modes.indexOf(state.repeat) + 1) % modes.length] };
          }),
        toggleFavorite: (song) =>
          set((state) => {
            const isFavorite = state.favorites.some((item) => item.id === song.id);
            return {
              favorites: isFavorite
                ? state.favorites.filter((item) => item.id !== song.id)
                : [song, ...state.favorites],
            };
          }),
        setSleepTimer: (minutes) =>
          set(
            minutes === null || !Number.isFinite(minutes) || minutes <= 0
              ? { sleepTimerEndsAt: null }
              : { sleepTimerEndsAt: Date.now() + minutes * 60_000 },
          ),
        clearHistory: () => set({ history: [] }),
        setCurrentView: (view) => set({ currentView: view, ...(view === 'search' ? {} : { searchQuery: '' }) }),
        setSearchQuery: (searchQuery) => set({ searchQuery }),
        setStatus: (status, error = null) =>
          set({
            status,
            error,
            ...(status === 'error' || status === 'idle'
              ? { activeSongId: null, isPlaying: false, playbackIntent: false }
              : {}),
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
            playlists: state.playlists.map((playlist) =>
              playlist.id === playlistId ? { ...playlist, name: trimmed } : playlist,
            ),
          }));
        },
        deletePlaylist: (playlistId) =>
          set((state) => ({
            playlists: state.playlists.filter((playlist) => playlist.id !== playlistId),
          })),
        // Adding a track twice is treated as a no-op rather than a duplicate row: the
        // control lives in a menu that is easy to hit twice, and a playlist holding
        // the same track back to back is never what was meant.
        addToPlaylist: (playlistId, song) =>
          set((state) => ({
            playlists: state.playlists.map((playlist) =>
              playlist.id !== playlistId || playlist.songs.some((item) => item.id === song.id)
                ? playlist
                : { ...playlist, songs: [...playlist.songs, song] },
            ),
          })),
        removeFromPlaylist: (playlistId, songId) =>
          set((state) => ({
            playlists: state.playlists.map((playlist) =>
              playlist.id === playlistId
                ? { ...playlist, songs: playlist.songs.filter((song) => song.id !== songId) }
                : playlist,
            ),
          })),
        reorderPlaylist: (playlistId, fromIndex, toIndex) =>
          set((state) => ({
            playlists: state.playlists.map((playlist) => {
              if (playlist.id !== playlistId) return playlist;
              const { songs } = playlist;
              if (
                !Number.isInteger(fromIndex) ||
                !Number.isInteger(toIndex) ||
                fromIndex < 0 ||
                toIndex < 0 ||
                fromIndex >= songs.length ||
                toIndex >= songs.length ||
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
      }),
      {
        name: PERSIST_KEY,
        storage: createJSONStorage(() => persistence.storage),
        skipHydration: true,
        version: PERSIST_VERSION,
        // Older payloads predate the shape checks below and were written by builds
        // that stored different fields. Rather than trust them, run them through
        // the same validator a current payload gets: whatever still fits is kept,
        // the rest falls back to defaults.
        migrate: (persisted) => sanitizePersistedState(persisted),
        // `merge` is the last point before rehydrated data becomes state, so the
        // validation has to happen here to cover both migrated and current
        // payloads.
        merge: (persisted, current) => ({ ...current, ...sanitizePersistedState(persisted) }),
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
      },
    ),
  );
}

/**
 * There is exactly one store per React tree, and it is created by the provider.
 *
 * A module-level singleton used to live here as well, with
 * `usePlayerStore.getState/setState/subscribe` bound to it. It was a different
 * object from the one the provider renders, so any static call read or wrote a
 * store no user was looking at — and on the server it was one mutable object
 * shared by every concurrent request. Nothing may recreate it: read state
 * through the hook, or take the store api from `usePlayerStoreApi`.
 */
/** The store as createPlayerStore builds it, persist api included. */
export type PlayerStore = ReturnType<typeof createPlayerStore>;

const PlayerStoreContext = createContext<PlayerStore | null>(null);

export function PlayerStoreProvider({
  initialView,
  initialQuery,
  children,
}: {
  initialView: ViewType;
  initialQuery: string;
  children: ReactNode;
}) {
  const [store] = useState(() => createPlayerStore(initialView, initialQuery));
  useEffect(() => {
    void store.persist.rehydrate();
  }, [store]);
  return createElement(PlayerStoreContext.Provider, { value: store }, children);
}

export function usePlayerStoreApi(): PlayerStore {
  const store = useContext(PlayerStoreContext);
  // Throwing beats falling back to a spare store: a silent fallback is exactly
  // how the two-store split stayed invisible, because reads succeeded and only
  // the answers were wrong.
  if (!store) throw new Error('usePlayerStore must be used inside PlayerStoreProvider');
  return store;
}

export function usePlayerStore<T>(selector: (state: PlayerState) => T): T {
  return useStore(usePlayerStoreApi(), selector);
}
