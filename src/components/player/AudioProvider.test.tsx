/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import type { Song } from '@/types/music';
import { NO_VERIFIED_FULL_TRACK_MESSAGE } from '@/lib/catalogTypes';
import type { MusicCatalog } from '@/lib/catalogTypes';
import { MusicCatalogProvider } from '@/lib/musicCatalog';

/**
 * A stand-in for Howler that never touches audio.
 *
 * Howler's constructor immediately probes codecs and opens an `Audio` element,
 * neither of which exists usefully in a test DOM — and the state machine under
 * test is entirely about *when* it calls load, play, retry and skip, not about
 * decoding. The fake records the callbacks the provider registers so a test can
 * fire `onload` / `onloaderror` / `onend` at the exact moment it wants.
 */
class FakeHowl {
  static instances: FakeHowl[] = [];
  static loadShouldFail = false;

  readonly src: string[];
  readonly options: Record<string, unknown>;
  readonly canPlayEventAtConstruction: string | undefined;
  unloaded = false;
  playCalls = 0;
  seekValue = 0;
  private durationValue = 100;
  private playing_ = false;
  private onceHandlers = new Map<string, Array<() => void>>();

  constructor(options: Record<string, unknown>) {
    this.src = options.src as string[];
    this.options = options;
    this.canPlayEventAtConstruction = fakeHowler._canPlayEvent;
    FakeHowl.instances.push(this);
    if (FakeHowl.loadShouldFail) {
      // Howler reports a load failure asynchronously, after the constructor.
      queueMicrotask(() => this.fire('onloaderror'));
    }
  }

  fire(event: string, ...args: unknown[]): void {
    const handler = this.options[event] as ((...a: unknown[]) => void) | undefined;
    handler?.(...args);
  }

  once(event: string, handler: () => void): void {
    const list = this.onceHandlers.get(event) ?? [];
    list.push(handler);
    this.onceHandlers.set(event, list);
  }

  emitOnce(event: string): void {
    const list = this.onceHandlers.get(event) ?? [];
    this.onceHandlers.set(event, []);
    for (const handler of list) handler();
  }

  duration(): number {
    return this.durationValue;
  }
  setDuration(value: number): void {
    this.durationValue = value;
  }
  playing(): boolean {
    return this.playing_;
  }
  play(): void {
    this.playCalls += 1;
    this.playing_ = true;
    this.fire('onplay');
  }
  pause(): void {
    this.playing_ = false;
    this.fire('onpause');
  }
  volume(): void {}
  unload(): void {
    this.unloaded = true;
    this.playing_ = false;
  }

  seek(position?: number): number {
    if (typeof position === 'number') this.seekValue = position;
    return this.seekValue;
  }
}

const fakeHowler: { _canPlayEvent?: string } = { _canPlayEvent: 'canplaythrough' };

vi.mock('howler', () => ({ Howl: FakeHowl, Howler: fakeHowler }));

const streamUrl = vi.fn<(song: Song) => Promise<string>>();
const getPlaybackSource =
  vi.fn<
    (song: Song) => Promise<{ song: Song; streamUrl: string; candidates?: Array<{ song: Song; streamUrl?: string }> }>
  >();
const getPlaybackAlternates = vi.fn<(song: Song) => Promise<Array<{ song: Song; streamUrl?: string }>>>();
const getGenreSongs =
  vi.fn<
    (
      tag: string,
      limit?: number,
      signal?: AbortSignal,
    ) => Promise<{ results: Song[]; failedProviders: string[]; providerCount: number }>
  >();
const catalog = {
  getStreamUrl: (song: Song) => streamUrl(song),
  getPlaybackSource: (song: Song) => getPlaybackSource(song),
  getPlaybackAlternates: (song: Song) => getPlaybackAlternates(song),
  getGenreSongs: (tag: string, limit?: number, signal?: AbortSignal) => getGenreSongs(tag, limit, signal),
} as MusicCatalog;

const { AudioProvider, useAudio } = await import('./AudioProvider');
const { PlayerStoreProvider, usePlayerStoreApi } = await import('@/store/playerStore');
type PlayerStore = import('@/store/playerStore').PlayerStore;

function song(id: string, overrides: Partial<Song> = {}): Song {
  return {
    id,
    title: `Title ${id}`,
    artist: 'Artist',
    artistId: 'artist-1',
    album: 'Album',
    albumId: 'album-1',
    coverArt: '/placeholder-album.svg',
    duration: 100,
    track: 1,
    year: 2026,
    genre: 'Test',
    path: `/stream/${id}`,
    bitRate: 0,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: 1,
    provider: 'Jamendo',
    sourceUrl: '',
    creatorUrl: '',
    licenseName: 'CC BY',
    licenseUrl: '',
    attributionUrl: '',
    metadataVerified: true,
    ...overrides,
  };
}

let store: PlayerStore;
let seekFn: (time: number) => void;

// Both probes publish through an effect rather than during render: assigning
// to an outer binding while rendering is a side effect, and Testing Library
// flushes effects before `render` returns, so the values are ready either way.
function Probe() {
  const api = usePlayerStoreApi();
  useEffect(() => {
    store = api;
  }, [api]);
  return null;
}

/** Reaches the provider's own `seek`, which is what the scrubber calls. */
function SeekProbe() {
  const { seek } = useAudio();
  useEffect(() => {
    seekFn = seek;
  }, [seek]);
  return null;
}

function mount() {
  return render(
    <PlayerStoreProvider initialView="albums" initialQuery="">
      <MusicCatalogProvider catalog={catalog}>
        <AudioProvider>
          <Probe />
          <SeekProbe />
        </AudioProvider>
      </MusicCatalogProvider>
    </PlayerStoreProvider>,
  );
}

/** Waits for the provider's async `getStreamUrl` chain to construct a Howl. */
async function latestHowl(index = 0): Promise<FakeHowl> {
  await waitFor(() => expect(FakeHowl.instances.length).toBeGreaterThan(index));
  return FakeHowl.instances[index];
}

beforeEach(() => {
  FakeHowl.instances = [];
  FakeHowl.loadShouldFail = false;
  fakeHowler._canPlayEvent = 'canplaythrough';
  streamUrl.mockReset();
  streamUrl.mockResolvedValue('https://cdn.example/audio.mp3');
  getPlaybackSource.mockReset();
  // The default: getPlaybackSource resolves the catalog song itself to a stream,
  // so no fallback identity is published (resolvedSong.id === song.id).
  getPlaybackSource.mockImplementation((s) => streamUrl(s).then((url) => ({ song: s, streamUrl: url })));
  getPlaybackAlternates.mockReset();
  getPlaybackAlternates.mockResolvedValue([]);
  getGenreSongs.mockReset();
  getGenreSongs.mockResolvedValue({ results: [], failedProviders: [], providerCount: 0 });
  window.localStorage.clear();
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1 as unknown as number);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('load and play', () => {
  it('loads the resolved stream and starts playing once the track is ready', async () => {
    const view = mount();
    act(() => {
      store.getState().playSong(song('a'));
    });

    const howl = await latestHowl();
    expect(howl.src).toEqual(['https://cdn.example/audio.mp3']);
    expect(store.getState().status).toBe('loading');

    act(() => {
      howl.fire('onload');
    });

    expect(store.getState()).toMatchObject({ duration: 100, isPlaying: true, status: 'playing' });
    view.unmount();
  });

  it('falls back to the catalog duration when the decoder reports none', async () => {
    const view = mount();
    act(() => {
      store.getState().playSong(song('a', { duration: 42 }));
    });

    const howl = await latestHowl();
    howl.setDuration(0);
    act(() => {
      howl.fire('onload');
    });

    expect(store.getState().duration).toBe(42);
    view.unmount();
  });

  it('skips a short decoded clip and advances to an attached full-track candidate', async () => {
    const catalogSong = song('catalog', { provider: 'Kuwo', duration: 184 });
    const alternate = song('alternate', { provider: 'Jamendo', duration: 184 });
    getPlaybackSource.mockResolvedValue({
      song: catalogSong,
      streamUrl: 'https://cdn.example/short.mp3',
      candidates: [{ song: catalogSong, streamUrl: 'https://cdn.example/short.mp3' }, { song: alternate }],
    });

    const view = mount();
    act(() => {
      store.getState().playSong(catalogSong);
    });

    const first = await latestHowl();
    first.setDuration(11);
    act(() => {
      first.fire('onload');
    });

    expect(first.unloaded).toBe(true);
    expect(store.getState().status).toBe('loading');
    const second = await latestHowl(1);
    second.setDuration(184);
    act(() => {
      second.fire('onload');
    });

    expect(store.getState()).toMatchObject({ duration: 184, isPlaying: true, status: 'playing' });
    expect(streamUrl).toHaveBeenCalledWith(alternate);
    view.unmount();
  });

  it('does not play a resolver response when its catalog duration is also preview length', async () => {
    const catalogSong = song('catalog', { provider: 'Kuwo', duration: 30 });
    const alternate = song('alternate', { provider: 'Jamendo', duration: 184 });
    getPlaybackSource.mockResolvedValue({
      song: catalogSong,
      streamUrl: 'https://cdn.example/short.mp3',
      candidates: [{ song: catalogSong, streamUrl: 'https://cdn.example/short.mp3' }, { song: alternate }],
    });

    const view = mount();
    act(() => {
      store.getState().playSong(catalogSong);
    });

    const first = await latestHowl();
    first.setDuration(30);
    act(() => {
      first.fire('onload');
    });

    expect(first.unloaded).toBe(true);
    expect(first.playCalls).toBe(0);
    const second = await latestHowl(1);
    second.setDuration(184);
    act(() => {
      second.fire('onload');
    });

    expect(store.getState()).toMatchObject({ duration: 184, isPlaying: true, status: 'playing' });
    expect(streamUrl).toHaveBeenCalledWith(alternate);
    view.unmount();
  });

  it('resolves recovery candidates lazily after a direct source decodes as a short clip', async () => {
    const catalogSong = song('catalog', { provider: 'Kuwo', duration: 184 });
    const alternate = song('alternate', { provider: 'Audius', duration: 184 });
    getPlaybackSource.mockResolvedValue({
      song: catalogSong,
      streamUrl: 'https://cdn.example/short.mp3',
    });
    getPlaybackAlternates.mockResolvedValue([{ song: alternate }]);

    const view = mount();
    act(() => {
      store.getState().playSong(catalogSong);
    });

    const first = await latestHowl();
    first.setDuration(11);
    act(() => {
      first.fire('onload');
    });

    await waitFor(() => expect(getPlaybackAlternates).toHaveBeenCalledWith(catalogSong));
    const second = await latestHowl(1);
    second.setDuration(184);
    act(() => {
      second.fire('onload');
    });

    expect(store.getState()).toMatchObject({ duration: 184, isPlaying: true, status: 'playing' });
    expect(streamUrl).toHaveBeenCalledWith(alternate);
    view.unmount();
  });

  it('tries the first alternate when the resolver cannot produce a direct source', async () => {
    const catalogSong = song('catalog', { provider: 'Kuwo', duration: 184 });
    const alternate = song('alternate', { provider: 'Audius', duration: 184 });
    getPlaybackSource.mockRejectedValue(new Error('short resolver response'));
    getPlaybackAlternates.mockResolvedValue([{ song: alternate }]);

    const view = mount();
    act(() => {
      store.getState().playSong(catalogSong);
    });

    await waitFor(() => expect(getPlaybackAlternates).toHaveBeenCalledWith(catalogSong));
    const fallback = await latestHowl();
    fallback.setDuration(184);
    act(() => {
      fallback.fire('onload');
    });

    expect(store.getState()).toMatchObject({ duration: 184, isPlaying: true, status: 'playing' });
    expect(streamUrl).toHaveBeenCalledWith(alternate);
    expect(store.getState().currentSong?.id).toBe(catalogSong.id);
    view.unmount();
  });

  it('does not accept an official preview returned during resolver recovery', async () => {
    const catalogSong = song('catalog', { provider: 'LX Music', duration: 184 });
    const preview = song('preview', { provider: 'Apple Preview', duration: 30, recordingDuration: 184 });
    getPlaybackSource.mockResolvedValue({
      song: catalogSong,
      streamUrl: 'https://cdn.example/short.mp3',
    });
    getPlaybackAlternates.mockResolvedValue([{ song: preview }]);

    const view = mount();
    act(() => {
      store.getState().playSong(catalogSong);
    });

    const first = await latestHowl();
    first.setDuration(11);
    act(() => {
      first.fire('onload');
    });

    await waitFor(() =>
      expect(store.getState()).toMatchObject({
        status: 'error',
        error: 'The provider returned a short preview instead of the full track.',
      }),
    );
    expect(FakeHowl.instances).toHaveLength(1);
    expect(store.getState().effectiveSong).toBeNull();
    view.unmount();
  });

  it('refuses a track whose length neither the decoder nor the catalog knows', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = mount();
    act(() => {
      store.getState().playSong(song('a', { duration: 0 }));
    });

    // Every attempt reports a load with no duration, including the two retries
    // the ladder spends before giving up.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const howl = await latestHowl(attempt);
      howl.setDuration(0);
      act(() => {
        howl.fire('onload');
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
    }

    // A zero-length track cannot be scrubbed or ended, so it is a failure
    // rather than something to play silently.
    expect(store.getState()).toMatchObject({
      status: 'error',
      error: 'The provider returned audio without a valid duration.',
    });
    view.unmount();
  });

  it('starts a continuous live stream without inventing a finite duration', async () => {
    const view = mount();
    act(() => {
      store.getState().playSong(song('live', { duration: 0, isLive: true }));
    });

    const howl = await latestHowl();
    howl.setDuration(Number.POSITIVE_INFINITY);
    act(() => {
      howl.fire('onload');
      howl.emitOnce('load');
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(store.getState()).toMatchObject({ duration: 0, isPlaying: true, status: 'playing' });
    expect(howl.options.preload).toBe('metadata');
    expect(howl.canPlayEventAtConstruction).toBe('canplay');
    expect(fakeHowler._canPlayEvent).toBe('canplaythrough');
    view.unmount();
  });
});

describe('retry ladder', () => {
  it('retries twice on load failure, then reports the error', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = mount();
    FakeHowl.loadShouldFail = true;
    act(() => {
      store.getState().playSong(song('a'));
    });

    await waitFor(() => expect(FakeHowl.instances).toHaveLength(1));
    // 300ms, then 600ms — two retries and no more.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await waitFor(() => expect(FakeHowl.instances).toHaveLength(2));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    await waitFor(() => expect(FakeHowl.instances).toHaveLength(3));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(FakeHowl.instances).toHaveLength(3);
    expect(store.getState()).toMatchObject({
      status: 'error',
      error: 'The audio stream could not be loaded. Try again.',
    });
    view.unmount();
  });

  it('gives up on a stream URL that cannot be resolved at all', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    streamUrl.mockRejectedValue(new Error('offline'));
    const view = mount();
    act(() => {
      store.getState().playSong(song('a'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(store.getState()).toMatchObject({
      status: 'error',
      error: 'The audio stream could not be resolved. Try again.',
    });
    view.unmount();
  });

  it('explains when a preview has no verified full recording', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getPlaybackSource.mockRejectedValue(new Error(NO_VERIFIED_FULL_TRACK_MESSAGE));

    const view = mount();
    act(() => {
      store.getState().playSong(song('preview-unavailable'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(store.getState()).toMatchObject({
      status: 'error',
      error: NO_VERIFIED_FULL_TRACK_MESSAGE,
    });
    view.unmount();
  });
});

describe('premature end recovery', () => {
  it('rejects an official preview that reaches the audio engine', async () => {
    const view = mount();
    const preview = song('apple-preview', {
      provider: 'Apple Preview',
      duration: 30,
      recordingDuration: 214,
    });
    act(() => {
      store.getState().toggleAutoplay();
      store.getState().playSong(preview);
    });

    const howl = await latestHowl();
    // A stale or mocked resolver must not be able to turn the catalog preview
    // into a successful playback session.
    howl.setDuration(0);
    act(() => {
      howl.fire('onload');
    });
    expect(FakeHowl.instances).toHaveLength(1);
    expect(howl.unloaded).toBe(true);
    expect(store.getState()).toMatchObject({
      currentSong: preview,
      isPlaying: false,
      playbackIntent: false,
      status: 'error',
      error: NO_VERIFIED_FULL_TRACK_MESSAGE,
    });
    view.unmount();
  });

  it('resumes from where a truncated stream stopped rather than skipping the rest', async () => {
    const view = mount();
    act(() => {
      store.getState().playSong(song('a', { duration: 100 }));
    });

    const first = await latestHowl();
    act(() => {
      first.fire('onload');
    });
    // Stream dies a third of the way in: `onend` with the position nowhere
    // near the known length.
    first.seek(33);
    act(() => {
      first.fire('onend');
    });

    expect(store.getState()).toMatchObject({ progress: 33, status: 'loading' });
    const second = await latestHowl(1);
    act(() => {
      second.fire('onload');
    });
    // The replacement picks up at the recorded position instead of at zero.
    expect(second.seek()).toBeCloseTo(33, 0);
    view.unmount();
  });

  it('stops trying after the recovery budget and does not advance the queue', async () => {
    const view = mount();
    act(() => {
      store.getState().setQueue([song('a'), song('b')], 0);
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const howl = await latestHowl(attempt);
      act(() => {
        howl.fire('onload');
      });
      howl.seek(10);
      act(() => {
        howl.fire('onend');
      });
    }

    await waitFor(() => expect(store.getState().status).toBe('error'));
    expect(store.getState().error).toContain('ended before the track finished');
    expect(store.getState().currentSong?.id).toBe('a');
    view.unmount();
  });

  it('advances to the next track when the stream really did finish', async () => {
    const view = mount();
    act(() => {
      store.getState().setQueue([song('a'), song('b')], 0);
    });

    const howl = await latestHowl();
    act(() => {
      howl.fire('onload');
    });
    howl.seek(100);
    act(() => {
      howl.fire('onend');
    });

    expect(store.getState().currentSong?.id).toBe('b');
    view.unmount();
  });
});

describe('autoplay', () => {
  it('appends verified recommendations and advances when the explicit queue ends', async () => {
    const recommendations = [song('b', { genre: 'Test' }), song('c', { genre: 'Test' })];
    getGenreSongs.mockResolvedValue({ results: recommendations, failedProviders: [], providerCount: 1 });
    const view = mount();
    act(() => {
      store.getState().playSong(song('a', { genre: 'Test' }));
    });

    const first = await latestHowl();
    act(() => {
      first.fire('onload');
    });
    first.seek(100);
    act(() => {
      first.fire('onend');
    });

    await waitFor(() => expect(store.getState().currentSong?.id).toBe('b'));
    expect(getGenreSongs).toHaveBeenCalledWith('Test', 18, expect.any(AbortSignal));
    expect(store.getState().queue.map((item) => item.song.id)).toEqual(['a', 'b', 'c']);
    expect(
      store
        .getState()
        .queue.slice(1)
        .map((item) => item.addedBy),
    ).toEqual(['autoplay', 'autoplay']);
    view.unmount();
  });

  it('honors autoplay being disabled while recommendations are loading', async () => {
    let release: (value: { results: Song[]; failedProviders: string[]; providerCount: number }) => void = () => {};
    getGenreSongs.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const view = mount();
    act(() => {
      store.getState().playSong(song('a', { genre: 'Test' }));
    });

    const first = await latestHowl();
    act(() => {
      first.fire('onload');
    });
    first.seek(100);
    act(() => {
      first.fire('onend');
    });
    await waitFor(() => expect(getGenreSongs).toHaveBeenCalled());

    act(() => {
      store.getState().toggleAutoplay();
    });
    await act(async () => {
      release({ results: [song('b', { genre: 'Test' })], failedProviders: [], providerCount: 1 });
    });

    await waitFor(() => expect(store.getState().status).toBe('paused'));
    expect(store.getState().autoplay).toBe(false);
    expect(store.getState().currentSong?.id).toBe('a');
    expect(store.getState().queue).toHaveLength(1);
    view.unmount();
  });
});

describe('load timeout and auto-skip', () => {
  async function exhaustLoadTimeoutRetries() {
    await act(async () => {
      // Three 15-second attempts, followed by the existing 300ms and 600ms
      // retry backoffs. The timeout now uses the same retry ladder as loaderror.
      await vi.advanceTimersByTimeAsync(45_900);
    });
  }

  it('retries a load that never completes before reporting the timeout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = mount();
    act(() => {
      store.getState().playSong(song('a'));
    });
    await latestHowl();

    await exhaustLoadTimeoutRetries();

    expect(FakeHowl.instances).toHaveLength(3);
    expect(store.getState()).toMatchObject({ status: 'error' });
    expect(store.getState().error).toContain('took too long to load');
    view.unmount();
  });

  it('moves past a dead track when the queue has somewhere else to go', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = mount();
    act(() => {
      store.getState().setQueue([song('a'), song('b')], 0);
    });
    await latestHowl();

    await exhaustLoadTimeoutRetries();
    expect(store.getState().status).toBe('error');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_600);
    });
    expect(store.getState().currentSong?.id).toBe('b');
    view.unmount();
  });

  it('stays on a dead track that is the last thing in the queue', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = mount();
    act(() => {
      store.getState().playSong(song('only'));
    });
    await latestHowl();

    await exhaustLoadTimeoutRetries();

    expect(store.getState()).toMatchObject({ status: 'error' });
    expect(store.getState().currentSong?.id).toBe('only');
    view.unmount();
  });

  it('cancels a pending skip once the user takes over', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = mount();
    act(() => {
      store.getState().setQueue([song('a'), song('b')], 0);
    });
    await latestHowl();

    await exhaustLoadTimeoutRetries();
    expect(store.getState().status).toBe('error');

    // Pressing play moves status off 'error', which is the signal the timer
    // checks before firing.
    act(() => {
      store.getState().togglePlay();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(store.getState().currentSong?.id).toBe('a');
    view.unmount();
  });
});

describe('stale load tokens', () => {
  it('never lets a superseded load write to the store', async () => {
    const view = mount();
    act(() => {
      store.getState().playSong(song('a'));
    });
    const stale = await latestHowl();
    stale.setDuration(11);

    // The track changes while the first Howl is still in flight.
    act(() => {
      store.getState().playSong(song('b'));
    });
    const fresh = await latestHowl(1);
    fresh.setDuration(22);

    act(() => {
      stale.fire('onload');
    });
    expect(store.getState().duration).not.toBe(11);
    // The abandoned instance is released rather than left holding a stream.
    expect(stale.unloaded).toBe(true);

    act(() => {
      fresh.fire('onload');
    });
    expect(store.getState()).toMatchObject({ duration: 22, status: 'playing' });
    view.unmount();
  });

  it('ignores engine events from a Howl that is no longer the active one', async () => {
    const view = mount();
    act(() => {
      store.getState().playSong(song('a'));
    });
    const first = await latestHowl();
    act(() => {
      first.fire('onload');
    });
    expect(store.getState().isPlaying).toBe(true);

    act(() => {
      store.getState().playSong(song('b'));
    });
    const second = await latestHowl(1);
    act(() => {
      second.fire('onload');
    });

    // The old instance reporting a pause must not stop the new track.
    act(() => {
      first.fire('onpause');
    });
    expect(store.getState()).toMatchObject({ currentSong: expect.objectContaining({ id: 'b' }), isPlaying: true });
    view.unmount();
  });

  it('drops a stream URL that resolves after the track has already moved on', async () => {
    let release: (url: string) => void = () => {};
    streamUrl.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const view = mount();

    act(() => {
      store.getState().playSong(song('a'));
    });
    act(() => {
      store.getState().playSong(song('b'));
    });
    const forB = await latestHowl();

    act(() => {
      release('https://cdn.example/stale.mp3');
    });
    await waitFor(() => expect(FakeHowl.instances).toHaveLength(1));
    expect(forB.src).toEqual(['https://cdn.example/audio.mp3']);
    view.unmount();
  });
});

describe('seeking', () => {
  it('accepts a seek on a track whose length only the catalog knows', async () => {
    const view = mount();
    act(() => {
      store.getState().playSong(song('a', { duration: 240 }));
    });

    const howl = await latestHowl();
    // The shape the fallback exists for: the decoder cannot report a length
    // while the first response is a 206, so only the catalog knows it is 4:00.
    howl.setDuration(0);
    act(() => {
      howl.fire('onload');
    });
    expect(store.getState().duration).toBe(240);

    act(() => {
      seekFn(90);
    });

    // Bounding by the decoded duration alone made this a silent no-op: the
    // scrubber rendered a full-width 4:00 track and dragging it did nothing.
    expect(howl.seek()).toBe(90);
    expect(store.getState().progress).toBe(90);
    view.unmount();
  });

  it('clamps a seek past the end to the length the progress bar is drawn from', async () => {
    const view = mount();
    act(() => {
      store.getState().playSong(song('a', { duration: 240 }));
    });

    const howl = await latestHowl();
    howl.setDuration(0);
    act(() => {
      howl.fire('onload');
    });

    act(() => {
      seekFn(9_999);
    });

    expect(howl.seek()).toBe(240);
    view.unmount();
  });
});

/**
 * The Media Session surface: the lock screen, the OS media popup, a headset's
 * buttons and a car stereo all drive playback through these handlers, and none
 * of them is reachable from inside the app's own UI. Nothing but a test can
 * catch a handler that was never registered.
 */
describe('media session', () => {
  interface FakeMediaSession {
    metadata: MediaMetadata | null;
    playbackState: MediaSessionPlaybackState;
    handlers: Map<MediaSessionAction, MediaSessionActionHandler | null>;
    positions: Array<MediaPositionState | undefined>;
    setActionHandler: (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => void;
    setPositionState: (state?: MediaPositionState) => void;
  }

  let session: FakeMediaSession;

  beforeEach(() => {
    session = {
      metadata: null,
      playbackState: 'none',
      handlers: new Map(),
      positions: [],
      setActionHandler(action, handler) {
        this.handlers.set(action, handler);
      },
      setPositionState(state) {
        this.positions.push(state);
      },
    };
    vi.stubGlobal('navigator', { mediaSession: session });
    vi.stubGlobal(
      'MediaMetadata',
      class {
        constructor(init: MediaMetadataInit) {
          Object.assign(this, init);
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Loads a track and returns its Howl, with the OS wiring already settled. */
  async function playing(overrides: Partial<Song> = {}) {
    const view = mount();
    act(() => {
      store.getState().playSong(song('a', overrides));
    });
    const howl = await latestHowl();
    act(() => {
      howl.fire('onload');
    });
    return { view, howl };
  }

  it('registers every action it advertises, including the seek offsets', async () => {
    const { view } = await playing();

    for (const action of [
      'play',
      'pause',
      'stop',
      'nexttrack',
      'previoustrack',
      'seekbackward',
      'seekforward',
      'seekto',
    ] as MediaSessionAction[]) {
      expect(session.handlers.get(action), `${action} handler`).toBeTypeOf('function');
    }
    view.unmount();
  });

  it('publishes a position the OS can draw a moving scrubber from', async () => {
    const { view } = await playing({ duration: 240 });

    expect(session.positions.at(-1)).toEqual({ duration: 100, position: 0, playbackRate: 1 });
    view.unmount();
  });

  it('republishes the position after a seek, so the lock screen does not lag', async () => {
    const { view } = await playing();

    session.positions.length = 0;
    act(() => {
      seekFn(42);
    });

    expect(session.positions.at(-1)).toEqual({ duration: 100, position: 42, playbackRate: 1 });
    view.unmount();
  });

  it('moves playback by the offset the platform asked for', async () => {
    const { view, howl } = await playing();
    act(() => {
      seekFn(50);
    });

    act(() => {
      session.handlers.get('seekforward')?.({ action: 'seekforward', seekOffset: 15 });
    });
    expect(howl.seek()).toBe(65);

    act(() => {
      session.handlers.get('seekbackward')?.({ action: 'seekbackward', seekOffset: 15 });
    });
    expect(howl.seek()).toBe(50);
    view.unmount();
  });

  it('falls back to ten seconds when the platform names no offset', async () => {
    const { view, howl } = await playing();
    act(() => {
      seekFn(50);
    });

    act(() => {
      session.handlers.get('seekforward')?.({ action: 'seekforward' });
    });

    expect(howl.seek()).toBe(60);
    view.unmount();
  });

  it('keeps the OS playback state in step with the engine', async () => {
    const { view } = await playing();
    expect(session.playbackState).toBe('playing');

    act(() => {
      store.getState().setPlaybackIntent(false);
    });
    await waitFor(() => expect(session.playbackState).toBe('paused'));
    view.unmount();
  });

  it('clears the metadata and the handlers when the queue empties', async () => {
    const { view } = await playing();

    act(() => {
      store.getState().setQueue([]);
    });

    await waitFor(() => expect(session.metadata).toBeNull());
    expect(session.playbackState).toBe('none');
    expect(session.handlers.get('play')).toBeNull();
    view.unmount();
  });

  it('survives a platform that exposes media session without position support', async () => {
    // Safari shipped the metadata half years before the position half.
    vi.stubGlobal('navigator', { mediaSession: { ...session, setPositionState: undefined } });

    const { view } = await playing();
    expect(store.getState().status).toBe('playing');
    view.unmount();
  });

  it('survives a platform that throws from setPositionState', async () => {
    vi.stubGlobal('navigator', {
      mediaSession: {
        ...session,
        setActionHandler: session.setActionHandler.bind(session),
        setPositionState: () => {
          throw new TypeError('nope');
        },
      },
    });

    const { view } = await playing();
    expect(store.getState().status).toBe('playing');
    view.unmount();
  });
});

describe('sleep timer', () => {
  it('stops playback when the deadline arrives, and clears itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = mount();
    act(() => {
      store.getState().playSong(song('a'));
    });
    const howl = await latestHowl();
    act(() => {
      howl.fire('onload');
    });
    expect(store.getState().isPlaying).toBe(true);

    act(() => {
      store.getState().setSleepTimer(15);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });

    expect(store.getState().playbackIntent).toBe(false);
    expect(store.getState().isPlaying).toBe(false);
    // Left set, the deadline would fire again the moment playback resumed.
    expect(store.getState().sleepTimerEndsAt).toBeNull();
    view.unmount();
  });

  it('leaves playback alone before the deadline', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = mount();
    act(() => {
      store.getState().playSong(song('a'));
    });
    const howl = await latestHowl();
    act(() => {
      howl.fire('onload');
    });

    act(() => {
      store.getState().setSleepTimer(30);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29 * 60_000);
    });

    expect(store.getState().isPlaying).toBe(true);
    view.unmount();
  });

  it('cancelling the timer keeps playback going past the original deadline', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = mount();
    act(() => {
      store.getState().playSong(song('a'));
    });
    const howl = await latestHowl();
    act(() => {
      howl.fire('onload');
    });

    act(() => {
      store.getState().setSleepTimer(15);
    });
    act(() => {
      store.getState().setSleepTimer(null);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20 * 60_000);
    });

    expect(store.getState().isPlaying).toBe(true);
    view.unmount();
  });
});

/**
 * A catalog row the user picked often resolves playback to a different — full,
 * verified — track: Apple/Deezer previews silently swap for a Kuwo/LX recording
 * with another id and another duration. The provider keeps `currentSong` as the
 * catalog identity (artwork, attribution, queue) but publishes the resolved
 * recording as `effectiveSong`, which is what lyrics match against. Without this,
 * LRCLIB is asked for a thirty-second song and the timed document cannot sync to
 * the clip that is actually playing.
 */
describe('effective playback identity', () => {
  it('publishes the resolved track when playback swaps in a different recording', async () => {
    const catalog = song('apple-1', { provider: 'Apple Preview', duration: 30 });
    const resolved = song('kuwo-1', { provider: 'Kuwo', duration: 240 });
    getPlaybackSource.mockImplementation(async () => ({
      song: resolved,
      streamUrl: 'https://cdn.example/kuwo.mp3',
    }));

    const view = mount();
    act(() => {
      store.getState().playSong(catalog);
    });

    await latestHowl();
    // currentSong keeps the catalog identity the user picked — artwork,
    // attribution and the queue stay keyed to what was selected.
    expect(store.getState().currentSong?.id).toBe('apple-1');
    // effectiveSong is the recording actually playing, so lyrics query its
    // title/artist/duration rather than the preview's.
    await waitFor(() => expect(store.getState().effectiveSong?.id).toBe('kuwo-1'));
    expect(store.getState().effectiveSong).toMatchObject({ provider: 'Kuwo', duration: 240 });
    view.unmount();
  });

  it('clears the resolved track on every new selection so it never lingers onto the next pick', async () => {
    const catalog = song('apple-1', { provider: 'Apple Preview', duration: 30 });
    const resolved = song('kuwo-1', { provider: 'Kuwo', duration: 240 });
    getPlaybackSource.mockImplementation(async () => ({
      song: resolved,
      streamUrl: 'https://cdn.example/kuwo.mp3',
    }));

    const view = mount();
    act(() => {
      store.getState().playSong(catalog);
    });
    await latestHowl();
    await waitFor(() => expect(store.getState().effectiveSong?.id).toBe('kuwo-1'));

    // A new selection must reset the resolved identity before it resolves again,
    // or the lyrics panel would briefly query the previous track's record.
    getPlaybackSource.mockImplementation(async (s) => ({
      song: s,
      streamUrl: 'https://cdn.example/next.mp3',
    }));
    act(() => {
      store.getState().playSong(song('plain-1'));
    });
    // Clear happens synchronously at the start of the load effect, before the
    // new resolution lands, so there is no window where a stale fallback survives.
    await waitFor(() => expect(store.getState().effectiveSong).toBeNull());
    expect(store.getState().currentSong?.id).toBe('plain-1');
    view.unmount();
  });

  it('moves to the next verified candidate when the first stream cannot load', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const catalog = song('apple-1', { provider: 'Apple Preview', duration: 30 });
    const first = song('kuwo-1', { provider: 'Kuwo', duration: 240 });
    const second = song('lxmusic-1', { provider: 'LX Music', duration: 242 });
    getPlaybackSource.mockResolvedValue({
      song: first,
      streamUrl: 'https://cdn.example/kuwo.mp3',
      candidates: [{ song: first, streamUrl: 'https://cdn.example/kuwo.mp3' }, { song: second }],
    });
    streamUrl.mockImplementation(async (resolved) => {
      if (resolved.id === 'lxmusic-1') return 'https://cdn.example/lx.mp3';
      return 'https://cdn.example/kuwo.mp3';
    });

    const view = mount();
    act(() => {
      store.getState().playSong(catalog);
    });

    const firstHowl = await latestHowl();
    act(() => {
      firstHowl.fire('onloaderror');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    const secondHowl = await latestHowl(1);
    expect(streamUrl).toHaveBeenCalledWith(second);

    act(() => {
      secondHowl.fire('onload');
    });
    expect(store.getState()).toMatchObject({
      currentSong: expect.objectContaining({ id: 'apple-1' }),
      effectiveSong: expect.objectContaining({ id: 'lxmusic-1', duration: 242 }),
      status: 'playing',
    });
    expect(secondHowl.src).toEqual(['https://cdn.example/lx.mp3']);
    view.unmount();
  });
  it('publishes nothing when the resolved track is the catalog row itself', async () => {
    // A track that is already a full, verified recording resolves to itself.
    // There is no swap, so no resolved identity is published — `effectiveSong`
    // stays null and lyrics fall back to the catalog row, which is correct.
    const view = mount();
    act(() => {
      store.getState().playSong(song('jamendo-1', { provider: 'Jamendo', duration: 200 }));
    });
    await latestHowl();
    await waitFor(() => expect(store.getState().status).toBe('loading'));
    expect(store.getState().currentSong?.id).toBe('jamendo-1');
    expect(store.getState().effectiveSong).toBeNull();
    view.unmount();
  });
});
