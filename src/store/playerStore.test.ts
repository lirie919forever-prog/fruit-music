import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types/music';
import { createPlayerStore, usePlayerStore } from '@/store/playerStore';

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

beforeEach(() => {
  usePlayerStore.setState({
    currentSong: null,
    activeSongId: null,
    queue: [],
    queueIndex: null,
    isPlaying: false,
    playbackIntent: false,
    lastNonZeroVolume: 0.7,
    progress: 0,
    duration: 0,
    shuffle: false,
    repeat: 'off',
    status: 'idle',
    error: null,
    transportCommand: null,
    favorites: [],
    history: [],
    playlists: [],
  });
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
    usePlayerStore.getState().togglePlay();
    expect(usePlayerStore.getState()).toMatchObject({
      currentSong: null,
      activeSongId: null,
      isPlaying: false,
      playbackIntent: false,
      status: 'idle',
    });
  });

  it('clamps queue start indices and resets timing', () => {
    usePlayerStore.getState().setQueue([song('a'), song('b')], 99);
    const state = usePlayerStore.getState();
    expect(state.queueIndex).toBe(1);
    expect(state.currentSong?.id).toBe('b');
    expect(state.progress).toBe(0);
    expect(state.duration).toBe(0);
  });

  it('navigates duplicate song IDs by queue index', () => {
    usePlayerStore.getState().setQueue([song('same'), song('same'), song('other')]);
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().queueIndex).toBe(1);
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().queueIndex).toBe(2);
  });

  it('emits a seek command when previous restarts the current song', () => {
    usePlayerStore.getState().setQueue([song('a'), song('b')], 1);
    usePlayerStore.setState({ progress: 10 });
    usePlayerStore.getState().previous();
    const state = usePlayerStore.getState();
    expect(state.queueIndex).toBe(1);
    expect(state.progress).toBe(0);
    expect(state.transportCommand).toMatchObject({ type: 'seek', position: 0 });
  });

  it('does not wrap previous at the first item unless repeat all is enabled', () => {
    usePlayerStore.getState().setQueue([song('a'), song('b')]);
    usePlayerStore.getState().previous();
    expect(usePlayerStore.getState().queueIndex).toBe(0);

    usePlayerStore.setState({ repeat: 'all', progress: 0 });
    usePlayerStore.getState().previous();
    expect(usePlayerStore.getState().queueIndex).toBe(1);
  });

  it('stops at the end or wraps for repeat all', () => {
    usePlayerStore.getState().setQueue([song('a'), song('b')], 1);
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(usePlayerStore.getState().queueIndex).toBe(1);

    usePlayerStore.setState({ repeat: 'all', isPlaying: true });
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().queueIndex).toBe(0);
  });

  it('shuffle avoids selecting the current entry when alternatives exist', () => {
    usePlayerStore.getState().setQueue([song('a'), song('b'), song('c')], 1);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    usePlayerStore.setState({ shuffle: true });
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().queueIndex).not.toBe(1);
    vi.restoreAllMocks();
  });

  it('keeps the active entry stable when an earlier item is removed', () => {
    usePlayerStore.getState().setQueue([song('a'), song('b'), song('c')], 2);
    usePlayerStore.getState().removeFromQueue(0);
    const state = usePlayerStore.getState();
    expect(state.queueIndex).toBe(1);
    expect(state.currentSong?.id).toBe('c');
  });

  it('selects a surviving entry when the active item is removed', () => {
    usePlayerStore.getState().setQueue([song('a'), song('b'), song('c')], 1);
    usePlayerStore.getState().removeFromQueue(1);
    const state = usePlayerStore.getState();
    expect(state.queueIndex).toBe(1);
    expect(state.currentSong?.id).toBe('c');
    expect(state.progress).toBe(0);
  });

  it('clears playback when the last queue item is removed', () => {
    usePlayerStore.getState().playSong(song('a'));
    usePlayerStore.getState().removeFromQueue(0);
    const state = usePlayerStore.getState();
    expect(state.queue).toEqual([]);
    expect(state.queueIndex).toBeNull();
    expect(state.currentSong).toBeNull();
    expect(state.activeSongId).toBeNull();
    expect(state.isPlaying).toBe(false);
  });

  it('accepts engine confirmation only for the current song', () => {
    usePlayerStore.getState().playSong(song('new'));
    usePlayerStore.getState().setEnginePlaying('old', true);
    expect(usePlayerStore.getState().isPlaying).toBe(false);

    usePlayerStore.getState().setEnginePlaying('new', true);
    expect(usePlayerStore.getState()).toMatchObject({
      activeSongId: 'new',
      isPlaying: true,
      status: 'playing',
    });
  });

  it('clears confirmed playback identity when switching tracks', () => {
    usePlayerStore.getState().playSong(song('a'));
    usePlayerStore.getState().setEnginePlaying('a', true);
    usePlayerStore.getState().playSong(song('b'));
    expect(usePlayerStore.getState()).toMatchObject({
      currentSong: expect.objectContaining({ id: 'b' }),
      activeSongId: null,
      isPlaying: false,
      status: 'loading',
    });
  });

  it('restores the previous volume after muting', () => {
    usePlayerStore.getState().setVolume(0.23);
    usePlayerStore.getState().toggleMute();
    expect(usePlayerStore.getState().volume).toBe(0);
    usePlayerStore.getState().toggleMute();
    expect(usePlayerStore.getState().volume).toBeCloseTo(0.23);
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
    expect(store.getState()).toMatchObject({ currentSong: expect.objectContaining({ id: 'a' }), currentView: 'search', status: 'loading' });
  });

  it('does not restart a replacement track when playback was paused', () => {
    usePlayerStore.getState().setQueue([song('a'), song('b')]);
    usePlayerStore.getState().setPlaybackIntent(false);
    usePlayerStore.getState().removeFromQueue(0);

    expect(usePlayerStore.getState()).toMatchObject({
      queueIndex: 0,
      currentSong: expect.objectContaining({ id: 'b' }),
      playbackIntent: false,
      status: 'paused',
    });
  });

  it('exposes terminal failures and makes retry an explicit loading state', () => {
    usePlayerStore.getState().playSong(song('a'));
    usePlayerStore.getState().setStatus('error', 'The stream failed.');
    expect(usePlayerStore.getState()).toMatchObject({
      status: 'error',
      error: 'The stream failed.',
      isPlaying: false,
      playbackIntent: false,
    });

    usePlayerStore.getState().togglePlay();
    expect(usePlayerStore.getState()).toMatchObject({
      status: 'loading',
      error: null,
      playbackIntent: true,
    });
  });

  it('keeps the selected song stable while reordering the queue', () => {
    usePlayerStore.getState().setQueue([song('a'), song('b'), song('c')], 1);
    usePlayerStore.getState().reorderQueue(0, 2);

    expect(usePlayerStore.getState()).toMatchObject({
      queue: expect.arrayContaining([
        expect.objectContaining({ song: expect.objectContaining({ id: 'b' }) }),
      ]),
      queueIndex: 0,
      currentSong: expect.objectContaining({ id: 'b' }),
    });
    expect(usePlayerStore.getState().queue.map((item) => item.song.id)).toEqual(['b', 'c', 'a']);
  });

  it('supports play-next and clear queue while keeping the current track', () => {
    const first = song('a');
    const second = song('b');
    const next = song('next');
    usePlayerStore.getState().setQueue([first, second], 0);
    usePlayerStore.getState().playNext(next);
    expect(usePlayerStore.getState().queue.map((item) => item.song.id)).toEqual(['a', 'next', 'b']);
    usePlayerStore.getState().clearQueue();
    expect(usePlayerStore.getState().queue.map((item) => item.song.id)).toEqual(['a']);
    expect(usePlayerStore.getState().currentSong?.id).toBe('a');
  });  it('keeps the active index when moving the active entry', () => {
    usePlayerStore.getState().setQueue([song('a'), song('b'), song('c')], 1);
    usePlayerStore.getState().reorderQueue(1, 2);

    expect(usePlayerStore.getState().queueIndex).toBe(2);
    expect(usePlayerStore.getState().currentSong?.id).toBe('b');
  });

  it('stores favorites and a bounded deduplicated playback history', () => {
    const first = song('a');
    const second = song('b');
    usePlayerStore.getState().toggleFavorite(first);
    usePlayerStore.getState().toggleFavorite(first);
    expect(usePlayerStore.getState().favorites).toEqual([]);

    usePlayerStore.getState().toggleFavorite(first);
    usePlayerStore.getState().playSong(first);
    usePlayerStore.getState().setEnginePlaying('a', true);
    usePlayerStore.getState().playSong(second);
    usePlayerStore.getState().setEnginePlaying('b', true);
    usePlayerStore.getState().playSong(first);
    usePlayerStore.getState().setEnginePlaying('a', true);

    expect(usePlayerStore.getState().favorites.map((track) => track.id)).toEqual(['a']);
    expect(usePlayerStore.getState().history.map((track) => track.id)).toEqual(['a', 'b']);
  });

  it('does not let a stale engine stop clear the current track', () => {
    usePlayerStore.getState().playSong(song('a'));
    usePlayerStore.getState().setEnginePlaying('a', true);
    usePlayerStore.getState().playSong(song('b'));
    usePlayerStore.getState().setEnginePlaying('a', false);

    expect(usePlayerStore.getState()).toMatchObject({
      currentSong: expect.objectContaining({ id: 'b' }),
      playbackIntent: true,
      status: 'loading',
    });
  });

  it('does not mutate queue state for an invalid queue entry index', () => {
    usePlayerStore.getState().setQueue([song('a')]);
    const before = usePlayerStore.getState();

    usePlayerStore.getState().playQueueIndex(-1);
    usePlayerStore.getState().playQueueIndex(1);
    usePlayerStore.getState().playQueueIndex(0.5);

    expect(usePlayerStore.getState()).toMatchObject({
      queueIndex: before.queueIndex,
      currentSong: before.currentSong,
      playbackIntent: before.playbackIntent,
      status: before.status,
    });
  });
});

describe('playlists', () => {
  it('creates a playlist, seeds it, and puts the newest first', () => {
    const first = usePlayerStore.getState().createPlaylist('Road trip', [song('a'), song('b')]);
    const second = usePlayerStore.getState().createPlaylist('Focus');

    const { playlists } = usePlayerStore.getState();
    expect(playlists.map((playlist) => playlist.id)).toEqual([second, first]);
    expect(playlists[1]).toMatchObject({ name: 'Road trip' });
    expect(playlists[1].songs.map((item) => item.id)).toEqual(['a', 'b']);
    expect(playlists[0].songs).toEqual([]);
  });

  it('trims names and refuses to create a blank playlist', () => {
    expect(usePlayerStore.getState().createPlaylist('  Evening  ')).toEqual(expect.any(String));
    expect(usePlayerStore.getState().createPlaylist('   ')).toBeNull();

    const { playlists } = usePlayerStore.getState();
    expect(playlists).toHaveLength(1);
    expect(playlists[0].name).toBe('Evening');
  });

  it('drops duplicates from the seed list and from later adds', () => {
    const id = usePlayerStore.getState().createPlaylist('Mix', [song('a'), song('a'), song('b')])!;

    usePlayerStore.getState().addToPlaylist(id, song('b'));
    usePlayerStore.getState().addToPlaylist(id, song('c'));

    expect(usePlayerStore.getState().playlists[0].songs.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('removes, renames, reorders, and deletes', () => {
    const id = usePlayerStore.getState().createPlaylist('Mix', [song('a'), song('b'), song('c')])!;

    usePlayerStore.getState().reorderPlaylist(id, 2, 0);
    expect(usePlayerStore.getState().playlists[0].songs.map((item) => item.id)).toEqual(['c', 'a', 'b']);

    usePlayerStore.getState().removeFromPlaylist(id, 'a');
    expect(usePlayerStore.getState().playlists[0].songs.map((item) => item.id)).toEqual(['c', 'b']);

    usePlayerStore.getState().renamePlaylist(id, '  Evening  ');
    expect(usePlayerStore.getState().playlists[0].name).toBe('Evening');

    usePlayerStore.getState().renamePlaylist(id, '   ');
    expect(usePlayerStore.getState().playlists[0].name).toBe('Evening');

    usePlayerStore.getState().deletePlaylist(id);
    expect(usePlayerStore.getState().playlists).toEqual([]);
  });

  it('ignores out-of-range reorders instead of dropping tracks', () => {
    const id = usePlayerStore.getState().createPlaylist('Mix', [song('a'), song('b')])!;

    usePlayerStore.getState().reorderPlaylist(id, -1, 0);
    usePlayerStore.getState().reorderPlaylist(id, 0, 5);
    usePlayerStore.getState().reorderPlaylist(id, 0.5, 1);
    usePlayerStore.getState().reorderPlaylist('missing', 0, 1);

    expect(usePlayerStore.getState().playlists[0].songs.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('leaves other playlists untouched when one changes', () => {
    const keep = usePlayerStore.getState().createPlaylist('Keep', [song('a')])!;
    const edit = usePlayerStore.getState().createPlaylist('Edit', [song('b')])!;

    usePlayerStore.getState().addToPlaylist(edit, song('c'));
    usePlayerStore.getState().removeFromPlaylist(edit, 'b');

    const byId = Object.fromEntries(usePlayerStore.getState().playlists.map((playlist) => [playlist.id, playlist]));
    expect(byId[keep].songs.map((item) => item.id)).toEqual(['a']);
    expect(byId[edit].songs.map((item) => item.id)).toEqual(['c']);
  });
});

describe('persistence write guard', () => {
  const KEY = 'marea-player-v1';
  let saved: Map<string, string>;

  function seed() {
    saved.set(KEY, JSON.stringify({
      state: { favorites: [song('kept')], history: [], playlists: [], volume: 0.7, lastNonZeroVolume: 0.7, shuffle: false, repeat: 'off' },
      version: 1,
    }));
  }

  function storedFavorites(): string[] {
    return JSON.parse(saved.get(KEY)!).state.favorites.map((item: Song) => item.id);
  }

  beforeEach(() => {
    saved = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (name: string) => saved.get(name) ?? null,
        setItem: (name: string, value: string) => { saved.set(name, value); },
        removeItem: (name: string) => { saved.delete(name); },
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
