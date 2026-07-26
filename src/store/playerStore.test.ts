import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types/music';
import { createPlayerStore } from '@/store/playerStore';
import type { PlayerState } from '@/store/playerStore';
import type { StoreApi } from 'zustand/vanilla';

function song(id: string): Song {
  return {
    id,
    title: id,
    artist: 'Artist',
    artistId: 'artist',
    album: 'Album',
    albumId: 'album',
    coverArt: '/placeholder-album.svg',
    duration: 120,
    track: 1,
    year: 2026,
    genre: 'Test',
    path: '',
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
  };
}

// A fresh store per test rather than resetting a shared one: that shared one
// was a module singleton no rendered tree ever used, so every assertion here
// was made against a store the app did not run on.
let store: StoreApi<PlayerState>;

beforeEach(() => {
  store = createPlayerStore();
});

describe('navigation state', () => {
  it('uses the server-provided view and search query as initial state', () => {
    const store = createPlayerStore('search', 'ocean');
    expect(store.getState()).toMatchObject({ currentView: 'search', searchQuery: 'ocean' });
  });

  it('drops stale search text when leaving Search', () => {
    const store = createPlayerStore('search', 'ocean');
    store.getState().setCurrentView('artists');
    expect(store.getState()).toMatchObject({ currentView: 'artists', searchQuery: '' });
  });
});

describe('player queue', () => {
  it('cannot enter a playing state without a selected track', () => {
    store.getState().togglePlay();
    expect(store.getState()).toMatchObject({
      currentSong: null,
      activeSongId: null,
      isPlaying: false,
      playbackIntent: false,
      status: 'idle',
    });
  });

  it('clamps queue start indices and resets timing', () => {
    store.getState().setQueue([song('a'), song('b')], 99);
    const state = store.getState();
    expect(state.queueIndex).toBe(1);
    expect(state.currentSong?.id).toBe('b');
    expect(state.progress).toBe(0);
    expect(state.duration).toBe(0);
  });

  it('navigates duplicate song IDs by queue index', () => {
    store.getState().setQueue([song('same'), song('same'), song('other')]);
    store.getState().next();
    expect(store.getState().queueIndex).toBe(1);
    store.getState().next();
    expect(store.getState().queueIndex).toBe(2);
  });

  it('emits a seek command when previous restarts the current song', () => {
    store.getState().setQueue([song('a'), song('b')], 1);
    store.setState({ progress: 10 });
    store.getState().previous();
    const state = store.getState();
    expect(state.queueIndex).toBe(1);
    expect(state.progress).toBe(0);
    expect(state.transportCommand).toMatchObject({ type: 'seek', position: 0 });
  });

  it('does not wrap previous at the first item unless repeat all is enabled', () => {
    store.getState().setQueue([song('a'), song('b')]);
    store.getState().previous();
    expect(store.getState().queueIndex).toBe(0);

    store.setState({ repeat: 'all', progress: 0 });
    store.getState().previous();
    expect(store.getState().queueIndex).toBe(1);
  });

  it('stops at the end or wraps for repeat all', () => {
    store.getState().setQueue([song('a'), song('b')], 1);
    store.getState().next();
    expect(store.getState().isPlaying).toBe(false);
    expect(store.getState().queueIndex).toBe(1);

    store.setState({ repeat: 'all', isPlaying: true });
    store.getState().next();
    expect(store.getState().queueIndex).toBe(0);
  });

  it('shuffle avoids selecting the current entry when alternatives exist', () => {
    store.getState().setQueue([song('a'), song('b'), song('c')], 1);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    store.getState().toggleShuffle();
    store.getState().next();
    expect(store.getState().queueIndex).not.toBe(1);
    vi.restoreAllMocks();
  });

  it('reaches every track exactly once per shuffled lap', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    store.getState().setQueue(ids.map(song), 0);
    store.getState().toggleShuffle();

    const visited = [store.getState().queueIndex!];
    for (let step = 0; step < ids.length - 1; step += 1) {
      store.getState().next();
      visited.push(store.getState().queueIndex!);
    }

    // The previous implementation drew a fresh random index on every `next`,
    // which is sampling with replacement: five steps could land on the same
    // track three times and never reach two of the others.
    expect([...visited].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('stops at the end of a shuffled lap unless repeat is on', () => {
    store.getState().setQueue([song('a'), song('b')], 0);
    store.getState().toggleShuffle();
    store.getState().next();
    store.getState().next();

    expect(store.getState()).toMatchObject({ isPlaying: false, playbackIntent: false, status: 'paused' });
  });

  it('starts a fresh lap on repeat rather than replaying the same order', () => {
    store.getState().setQueue([song('a'), song('b'), song('c')], 0);
    store.getState().toggleShuffle();
    store.setState({ repeat: 'all' });

    const seen = new Set<number>();
    for (let step = 0; step < 6; step += 1) {
      store.getState().next();
      seen.add(store.getState().queueIndex!);
    }
    expect(seen.size).toBe(3);
  });

  it('previous retraces the track actually played, not the one above in the queue', () => {
    store.getState().setQueue([song('a'), song('b'), song('c'), song('d')], 0);
    store.getState().toggleShuffle();

    store.getState().next();
    const firstHop = store.getState().queueIndex!;
    store.getState().next();
    const secondHop = store.getState().queueIndex!;
    expect(secondHop).not.toBe(firstHop);

    store.setState({ progress: 0 });
    store.getState().previous();
    expect(store.getState().queueIndex).toBe(firstHop);

    store.setState({ progress: 0 });
    store.getState().previous();
    expect(store.getState().queueIndex).toBe(0);
  });

  it('discards a shuffle order once the queue it described has changed', () => {
    store.getState().setQueue([song('a'), song('b'), song('c')], 0);
    store.getState().toggleShuffle();
    expect(store.getState().shuffleOrder).toHaveLength(3);

    store.getState().addToQueue(song('d'));
    expect(store.getState().shuffleOrder).toEqual([]);

    // A stale order would index past the end or skip the new entry; `next`
    // has to rebuild rather than trust it.
    store.getState().next();
    expect(store.getState().queueIndex).toBeLessThan(4);
    expect(store.getState().shuffleOrder).toHaveLength(4);
  });

  it('keeps the active entry stable when an earlier item is removed', () => {
    store.getState().setQueue([song('a'), song('b'), song('c')], 2);
    store.getState().removeFromQueue(0);
    const state = store.getState();
    expect(state.queueIndex).toBe(1);
    expect(state.currentSong?.id).toBe('c');
  });

  it('selects a surviving entry when the active item is removed', () => {
    store.getState().setQueue([song('a'), song('b'), song('c')], 1);
    store.getState().removeFromQueue(1);
    const state = store.getState();
    expect(state.queueIndex).toBe(1);
    expect(state.currentSong?.id).toBe('c');
    expect(state.progress).toBe(0);
  });

  it('clears playback when the last queue item is removed', () => {
    store.getState().playSong(song('a'));
    store.getState().removeFromQueue(0);
    const state = store.getState();
    expect(state.queue).toEqual([]);
    expect(state.queueIndex).toBeNull();
    expect(state.currentSong).toBeNull();
    expect(state.activeSongId).toBeNull();
    expect(state.isPlaying).toBe(false);
  });

  it('accepts engine confirmation only for the current song', () => {
    store.getState().playSong(song('new'));
    store.getState().setEnginePlaying('old', true);
    expect(store.getState().isPlaying).toBe(false);

    store.getState().setEnginePlaying('new', true);
    expect(store.getState()).toMatchObject({
      activeSongId: 'new',
      isPlaying: true,
      status: 'playing',
    });
  });

  it('clears confirmed playback identity when switching tracks', () => {
    store.getState().playSong(song('a'));
    store.getState().setEnginePlaying('a', true);
    store.getState().playSong(song('b'));
    expect(store.getState()).toMatchObject({
      currentSong: expect.objectContaining({ id: 'b' }),
      activeSongId: null,
      isPlaying: false,
      status: 'loading',
    });
  });

  it('restores the previous volume after muting', () => {
    store.getState().setVolume(0.23);
    store.getState().toggleMute();
    expect(store.getState().volume).toBe(0);
    store.getState().toggleMute();
    expect(store.getState().volume).toBeCloseTo(0.23);
  });

  it('plays a selected queue entry and preserves the current browse view', () => {
    const store = createPlayerStore('jp');
    store.getState().setQueue([song('a'), song('b')]);
    store.setState({
      activeSongId: 'a',
      isPlaying: true,
      progress: 42,
      duration: 120,
      error: 'stale failure',
      transportCommand: { sequence: 1, type: 'seek', position: 42 },
    });

    store.getState().playQueueIndex(1);

    expect(store.getState()).toMatchObject({
      queueIndex: 1,
      currentSong: expect.objectContaining({ id: 'b' }),
      activeSongId: null,
      isPlaying: false,
      playbackIntent: true,
      progress: 0,
      duration: 0,
      status: 'loading',
      error: null,
      transportCommand: null,
      currentView: 'jp',
    });
  });

  it('preserves the browse view when starting an isolated track', () => {
    const store = createPlayerStore('search');
    store.getState().playSong(song('a'));
    expect(store.getState()).toMatchObject({
      currentSong: expect.objectContaining({ id: 'a' }),
      currentView: 'search',
      status: 'loading',
    });
  });

  it('does not restart a replacement track when playback was paused', () => {
    store.getState().setQueue([song('a'), song('b')]);
    store.getState().setPlaybackIntent(false);
    store.getState().removeFromQueue(0);

    expect(store.getState()).toMatchObject({
      queueIndex: 0,
      currentSong: expect.objectContaining({ id: 'b' }),
      playbackIntent: false,
      status: 'paused',
    });
  });

  it('exposes terminal failures and makes retry an explicit loading state', () => {
    store.getState().playSong(song('a'));
    store.getState().setStatus('error', 'The stream failed.');
    expect(store.getState()).toMatchObject({
      status: 'error',
      error: 'The stream failed.',
      isPlaying: false,
      playbackIntent: false,
    });

    store.getState().togglePlay();
    expect(store.getState()).toMatchObject({
      status: 'loading',
      error: null,
      playbackIntent: true,
    });
  });

  it('keeps the selected song stable while reordering the queue', () => {
    store.getState().setQueue([song('a'), song('b'), song('c')], 1);
    store.getState().reorderQueue(0, 2);

    expect(store.getState()).toMatchObject({
      queue: expect.arrayContaining([expect.objectContaining({ song: expect.objectContaining({ id: 'b' }) })]),
      queueIndex: 0,
      currentSong: expect.objectContaining({ id: 'b' }),
    });
    expect(store.getState().queue.map((item) => item.song.id)).toEqual(['b', 'c', 'a']);
  });

  it('supports play-next and clear queue while keeping the current track', () => {
    const first = song('a');
    const second = song('b');
    const next = song('next');
    store.getState().setQueue([first, second], 0);
    store.getState().playNext(next);
    expect(store.getState().queue.map((item) => item.song.id)).toEqual(['a', 'next', 'b']);
    store.getState().clearQueue();
    expect(store.getState().queue.map((item) => item.song.id)).toEqual(['a']);
    expect(store.getState().currentSong?.id).toBe('a');
  });
  it('keeps the active index when moving the active entry', () => {
    store.getState().setQueue([song('a'), song('b'), song('c')], 1);
    store.getState().reorderQueue(1, 2);

    expect(store.getState().queueIndex).toBe(2);
    expect(store.getState().currentSong?.id).toBe('b');
  });

  it('stores favorites and a bounded deduplicated playback history', () => {
    const first = song('a');
    const second = song('b');
    store.getState().toggleFavorite(first);
    store.getState().toggleFavorite(first);
    expect(store.getState().favorites).toEqual([]);

    store.getState().toggleFavorite(first);
    store.getState().playSong(first);
    store.getState().setEnginePlaying('a', true);
    store.getState().playSong(second);
    store.getState().setEnginePlaying('b', true);
    store.getState().playSong(first);
    store.getState().setEnginePlaying('a', true);

    expect(store.getState().favorites.map((track) => track.id)).toEqual(['a']);
    expect(store.getState().history.map((track) => track.id)).toEqual(['a', 'b']);
  });

  it('does not let a stale engine stop clear the current track', () => {
    store.getState().playSong(song('a'));
    store.getState().setEnginePlaying('a', true);
    store.getState().playSong(song('b'));
    store.getState().setEnginePlaying('a', false);

    expect(store.getState()).toMatchObject({
      currentSong: expect.objectContaining({ id: 'b' }),
      playbackIntent: true,
      status: 'loading',
    });
  });

  it('does not mutate queue state for an invalid queue entry index', () => {
    store.getState().setQueue([song('a')]);
    const before = store.getState();

    store.getState().playQueueIndex(-1);
    store.getState().playQueueIndex(1);
    store.getState().playQueueIndex(0.5);

    expect(store.getState()).toMatchObject({
      queueIndex: before.queueIndex,
      currentSong: before.currentSong,
      playbackIntent: before.playbackIntent,
      status: before.status,
    });
  });
});

describe('playlists', () => {
  it('creates a playlist, seeds it, and puts the newest first', () => {
    const first = store.getState().createPlaylist('Road trip', [song('a'), song('b')]);
    const second = store.getState().createPlaylist('Focus');

    const { playlists } = store.getState();
    expect(playlists.map((playlist) => playlist.id)).toEqual([second, first]);
    expect(playlists[1]).toMatchObject({ name: 'Road trip' });
    expect(playlists[1].songs.map((item) => item.id)).toEqual(['a', 'b']);
    expect(playlists[0].songs).toEqual([]);
  });

  it('trims names and refuses to create a blank playlist', () => {
    expect(store.getState().createPlaylist('  Evening  ')).toEqual(expect.any(String));
    expect(store.getState().createPlaylist('   ')).toBeNull();

    const { playlists } = store.getState();
    expect(playlists).toHaveLength(1);
    expect(playlists[0].name).toBe('Evening');
  });

  it('drops duplicates from the seed list and from later adds', () => {
    const id = store.getState().createPlaylist('Mix', [song('a'), song('a'), song('b')])!;

    store.getState().addToPlaylist(id, song('b'));
    store.getState().addToPlaylist(id, song('c'));

    expect(store.getState().playlists[0].songs.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('removes, renames, reorders, and deletes', () => {
    const id = store.getState().createPlaylist('Mix', [song('a'), song('b'), song('c')])!;

    store.getState().reorderPlaylist(id, 2, 0);
    expect(store.getState().playlists[0].songs.map((item) => item.id)).toEqual(['c', 'a', 'b']);

    store.getState().removeFromPlaylist(id, 'a');
    expect(store.getState().playlists[0].songs.map((item) => item.id)).toEqual(['c', 'b']);

    store.getState().renamePlaylist(id, '  Evening  ');
    expect(store.getState().playlists[0].name).toBe('Evening');

    store.getState().renamePlaylist(id, '   ');
    expect(store.getState().playlists[0].name).toBe('Evening');

    store.getState().deletePlaylist(id);
    expect(store.getState().playlists).toEqual([]);
  });

  it('ignores out-of-range reorders instead of dropping tracks', () => {
    const id = store.getState().createPlaylist('Mix', [song('a'), song('b')])!;

    store.getState().reorderPlaylist(id, -1, 0);
    store.getState().reorderPlaylist(id, 0, 5);
    store.getState().reorderPlaylist(id, 0.5, 1);
    store.getState().reorderPlaylist('missing', 0, 1);

    expect(store.getState().playlists[0].songs.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('leaves other playlists untouched when one changes', () => {
    const keep = store.getState().createPlaylist('Keep', [song('a')])!;
    const edit = store.getState().createPlaylist('Edit', [song('b')])!;

    store.getState().addToPlaylist(edit, song('c'));
    store.getState().removeFromPlaylist(edit, 'b');

    const byId = Object.fromEntries(store.getState().playlists.map((playlist) => [playlist.id, playlist]));
    expect(byId[keep].songs.map((item) => item.id)).toEqual(['a']);
    expect(byId[edit].songs.map((item) => item.id)).toEqual(['c']);
  });
});

describe('persistence write guard', () => {
  const KEY = 'marea-player-v1';
  let saved: Map<string, string>;

  function seed() {
    saved.set(
      KEY,
      JSON.stringify({
        state: {
          favorites: [song('kept')],
          history: [],
          playlists: [],
          volume: 0.7,
          lastNonZeroVolume: 0.7,
          shuffle: false,
          repeat: 'off',
        },
        version: 1,
      }),
    );
  }

  function storedFavorites(): string[] {
    return JSON.parse(saved.get(KEY)!).state.favorites.map((item: Song) => item.id);
  }

  beforeEach(() => {
    saved = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (name: string) => saved.get(name) ?? null,
        setItem: (name: string, value: string) => {
          saved.set(name, value);
        },
        removeItem: (name: string) => {
          saved.delete(name);
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not overwrite saved state with defaults before rehydration', () => {
    seed();
    const store = createPlayerStore();

    // Child effects mutate the store before the provider's rehydrate effect
    // runs. None of these writes may reach storage.
    store.getState().setStatus('idle');
    store.getState().setCurrentView('new');
    store.getState().setVolume(0.1);

    expect(storedFavorites()).toEqual(['kept']);
  });

  it('persists again once rehydration has completed', async () => {
    seed();
    const store = createPlayerStore();

    await store.persist.rehydrate();
    expect(store.getState().favorites.map((item) => item.id)).toEqual(['kept']);

    store.getState().toggleFavorite(song('added'));

    expect(storedFavorites()).toEqual(['added', 'kept']);
  });

  it('still allows writes when there was nothing saved to rehydrate', async () => {
    const store = createPlayerStore();

    await store.persist.rehydrate();
    store.getState().toggleFavorite(song('first'));

    expect(storedFavorites()).toEqual(['first']);
  });
});
