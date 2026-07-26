/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import {
  PERSIST_KEY,
  PERSIST_VERSION,
  PlayerStoreProvider,
  createGuardedStorage,
  sanitizePersistedState,
  usePlayerStoreApi,
  type PlayerStore,
} from '@/store/playerStore';
import type { Song } from '@/types/music';

function song(id: string, overrides: Partial<Song> = {}): Song {
  return {
    id,
    title: `Title ${id}`,
    artist: 'Artist',
    artistId: 'artist-1',
    album: 'Album',
    albumId: 'album-1',
    coverArt: '/placeholder-album.svg',
    duration: 120,
    track: 1,
    year: 2026,
    genre: 'Test',
    path: `/api/music/jamendo/stream/${id}`,
    bitRate: 0,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: 1,
    provider: 'Jamendo',
    sourceUrl: 'https://example.com/track',
    creatorUrl: 'https://example.com/artist',
    licenseName: 'CC BY',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attributionUrl: 'https://example.com/track',
    metadataVerified: true,
    ...overrides,
  };
}

function seed(state: Record<string, unknown>, version = PERSIST_VERSION): void {
  window.localStorage.setItem(PERSIST_KEY, JSON.stringify({ state, version }));
}

function readStored(): Record<string, unknown> | null {
  const raw = window.localStorage.getItem(PERSIST_KEY);
  return raw ? (JSON.parse(raw) as { state: Record<string, unknown> }).state : null;
}

/**
 * Mounts the provider and hands back the store the tree is actually using.
 *
 * The provider is the only thing that calls `persist.rehydrate()`, so a test
 * that builds a store directly never exercises the hydrate/write ordering that
 * the guard exists for — which is exactly why this bug survived a test suite.
 */
function mountApp(): { store: PlayerStore; unmount: () => void } {
  let store: PlayerStore | null = null;
  function Probe() {
    store = usePlayerStoreApi();
    return null;
  }
  const view = render(
    <PlayerStoreProvider initialView="albums" initialQuery="">
      <Probe />
    </PlayerStoreProvider>,
  );
  if (!store) throw new Error('provider did not render');
  return { store, unmount: view.unmount };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('persisted library survives a reload', () => {
  it('restores favorites, history, playlists and volume across mount → unmount → remount', async () => {
    const first = mountApp();
    await waitFor(() => expect(first.store.persist.hasHydrated()).toBe(true));

    act(() => {
      first.store.getState().toggleFavorite(song('fav-1'));
      first.store.getState().playSong(song('played-1'));
      first.store.getState().setEnginePlaying('played-1', true);
      first.store.getState().createPlaylist('Road trip', [song('a'), song('b')]);
      first.store.getState().setVolume(0.42);
      first.store.getState().toggleShuffle();
    });
    first.unmount();

    const second = mountApp();
    await waitFor(() => expect(second.store.persist.hasHydrated()).toBe(true));
    const state = second.store.getState();

    expect(state.favorites.map((item) => item.id)).toEqual(['fav-1']);
    expect(state.history.map((item) => item.id)).toEqual(['played-1']);
    expect(state.playlists.map((item) => item.name)).toEqual(['Road trip']);
    expect(state.playlists[0].songs.map((item) => item.id)).toEqual(['a', 'b']);
    expect(state.volume).toBeCloseTo(0.42);
    expect(state.shuffle).toBe(true);
    second.unmount();
  });

  it('does not let an early write clear the saved payload before it is read back', async () => {
    seed({
      favorites: [song('saved-fav')],
      history: [song('saved-history')],
      playlists: [{ id: 'p1', name: 'Saved', songs: [song('x')], createdAt: 1 }],
      volume: 0.31,
      lastNonZeroVolume: 0.31,
      shuffle: true,
      repeat: 'all',
    });

    // The exact shape of the original bug: React runs child effects before
    // parent ones, so a child's `setStatus` reached persist before the
    // provider's rehydrate effect. Anything written at that moment is the
    // *empty* initial state, which used to overwrite everything above.
    let store: PlayerStore | null = null;
    function EagerChild() {
      const api = usePlayerStoreApi();
      store = api;
      // A useState initialiser runs during render, strictly before every
      // effect — the earliest a child can possibly touch the store.
      useState(() => {
        api.getState().setStatus('loading');
        api.getState().setProgress(1);
        return null;
      });
      return null;
    }
    const view = render(
      <PlayerStoreProvider initialView="albums" initialQuery="">
        <EagerChild />
      </PlayerStoreProvider>,
    );

    // Before hydration the stored payload must still be the seeded one.
    expect(readStored()).toMatchObject({ volume: 0.31, shuffle: true, repeat: 'all' });

    await waitFor(() => expect(store!.persist.hasHydrated()).toBe(true));
    const state = store!.getState();
    expect(state.favorites.map((item) => item.id)).toEqual(['saved-fav']);
    expect(state.history.map((item) => item.id)).toEqual(['saved-history']);
    expect(state.playlists[0].name).toBe('Saved');
    expect(state.volume).toBeCloseTo(0.31);
    expect(state.repeat).toBe('all');
    view.unmount();
  });

  it('writes nothing at all before rehydration settles', () => {
    const backing = window.localStorage;
    const setItem = vi.spyOn(backing, 'setItem');
    const { storage, allowWrites, dispose } = createGuardedStorage(() => backing);

    storage.setItem(PERSIST_KEY, 'before');
    expect(setItem).not.toHaveBeenCalled();

    allowWrites();
    storage.setItem(PERSIST_KEY, 'after');
    expect(setItem).toHaveBeenCalledExactlyOnceWith(PERSIST_KEY, 'after');
    dispose();
  });
});

describe('a damaged payload does not take the app down with it', () => {
  it('starts usable on truncated JSON and still saves afterwards', async () => {
    window.localStorage.setItem(PERSIST_KEY, '{"state":{"favorites":[{"id":"a"');

    const { store, unmount } = mountApp();

    // Parsing threw, so zustand never marks the store hydrated — it only runs
    // the rehydrate callback with the error. The app has to be usable anyway.
    expect(store.getState().favorites).toEqual([]);
    expect(store.getState().playlists).toEqual([]);

    // The guard has to open on a failed rehydrate too, or one bad payload
    // means nothing is ever saved again for the rest of the session.
    await waitFor(() => {
      act(() => { store.getState().toggleFavorite(song('recovered')); });
      expect(readStored()).toMatchObject({ favorites: [expect.objectContaining({ id: 'recovered' })] });
    });
    unmount();
  });

  it('drops individual malformed records instead of the whole library', async () => {
    seed({
      favorites: [song('good'), { id: 'no-title' }, null, 'nonsense'],
      history: 'not an array',
      playlists: [
        { id: 'p1', name: 'Half good', songs: [song('ok'), { id: 'broken' }], createdAt: 1 },
        { name: 'no id', songs: [], createdAt: 1 },
      ],
      volume: 42,
      repeat: 'sideways',
    });

    const { store, unmount } = mountApp();
    await waitFor(() => expect(store.persist.hasHydrated()).toBe(true));
    const state = store.getState();

    expect(state.favorites.map((item) => item.id)).toEqual(['good']);
    expect(state.history).toEqual([]);
    expect(state.playlists.map((item) => item.id)).toEqual(['p1']);
    expect(state.playlists[0].songs.map((item) => item.id)).toEqual(['ok']);
    // Out-of-range and unrecognised values fall back rather than reaching the UI.
    expect(state.volume).toBe(1);
    expect(state.repeat).toBe('off');
    unmount();
  });

  it('migrates an older payload through the same validation', () => {
    expect(sanitizePersistedState({ favorites: [song('kept'), { id: 'dropped' }], volume: -3 }))
      .toEqual({ favorites: [expect.objectContaining({ id: 'kept' })], volume: 0 });
  });
});

describe('storage that misbehaves', () => {
  it('swallows a quota failure and warns instead of throwing into the caller', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const quotaError = new Error('full');
    quotaError.name = 'QuotaExceededError';
    const backing = {
      getItem: () => null,
      setItem: () => { throw quotaError; },
      removeItem: () => {},
    } as unknown as Storage;

    const { storage, allowWrites, dispose } = createGuardedStorage(() => backing);
    allowWrites();

    expect(() => storage.setItem(PERSIST_KEY, 'value')).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('local storage is full'));
    dispose();
  });

  it('reads as empty when storage access itself throws', () => {
    const backing = {
      get getItem(): never { throw new Error('blocked'); },
    } as unknown as Storage;
    const { storage, dispose } = createGuardedStorage(() => backing);

    expect(storage.getItem(PERSIST_KEY)).toBeNull();
    dispose();
  });

  it('fails open so a rehydrate that never settles does not block writing forever', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const written: string[] = [];
    const backing = {
      getItem: () => null,
      setItem: (_key: string, value: string) => { written.push(value); },
      removeItem: () => {},
    } as unknown as Storage;

    const { storage, dispose } = createGuardedStorage(() => backing, 5_000);
    storage.setItem(PERSIST_KEY, 'blocked');
    expect(written).toEqual([]);

    vi.advanceTimersByTime(5_000);
    storage.setItem(PERSIST_KEY, 'allowed');

    expect(written).toEqual(['allowed']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('rehydration did not settle'));
    dispose();
  });
});

