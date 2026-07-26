/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import type { Song } from '@/types/music';

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
  unloaded = false;
  playCalls = 0;
  seekValue = 0;
  private durationValue = 100;
  private playing_ = false;
  private onceHandlers = new Map<string, Array<() => void>>();

  constructor(options: Record<string, unknown>) {
    this.src = options.src as string[];
    this.options = options;
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

vi.mock('howler', () => ({ Howl: FakeHowl }));

const streamUrl = vi.fn<(song: Song) => Promise<string>>();
vi.mock('@/lib/api', () => ({
  api: { getStreamUrl: (song: Song) => streamUrl(song) },
}));

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
      <AudioProvider>
        <Probe />
        <SeekProbe />
      </AudioProvider>
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
  streamUrl.mockReset();
  streamUrl.mockResolvedValue('https://cdn.example/audio.mp3');
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
});

describe('premature end recovery', () => {
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

describe('load timeout and auto-skip', () => {
  it('fails a load that never completes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = mount();
    act(() => {
      store.getState().playSong(song('a'));
    });
    await latestHowl();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000 + 2_000);
    });

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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
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
