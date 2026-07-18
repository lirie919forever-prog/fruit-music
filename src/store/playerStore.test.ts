import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('plays a selected queue entry and clears stale timing state', () => {
    usePlayerStore.getState().setQueue([song('a'), song('b')]);
    usePlayerStore.setState({
      activeSongId: 'a',
      isPlaying: true,
      progress: 42,
      duration: 120,
      error: 'stale failure',
      transportCommand: { sequence: 1, type: 'seek', position: 42 },
    });

    usePlayerStore.getState().playQueueIndex(1);

    expect(usePlayerStore.getState()).toMatchObject({
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
      currentView: 'now-playing',
    });
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
