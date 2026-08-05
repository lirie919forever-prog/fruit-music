/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlayerStoreProvider, usePlayerStoreApi, type PlayerStore } from '@/store/playerStore';
import { LyricsPanel } from './LyricsPanel';
import type { MusicCatalog } from '@/lib/catalogTypes';
import { MusicCatalogProvider } from '@/lib/musicCatalog';
import type { LyricsResult } from '@/lib/lyrics/lrclib';
import type { Song } from '@/types/music';

const seekSpy = vi.fn();
vi.mock('@/components/player/AudioProvider', () => ({
  useAudio: () => ({ seek: seekSpy, stop: () => {}, getHowl: () => null }),
}));

const getLyrics = vi.fn<(song: Song, signal?: AbortSignal) => Promise<LyricsResult | null>>();
const catalogService = {
  getLyrics: (song: Song, signal?: AbortSignal) => getLyrics(song, signal),
} as MusicCatalog;

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: 'itunes-1',
    title: 'Creep',
    artist: 'Radiohead',
    artistId: 'itunes-artist-1',
    album: 'Pablo Honey',
    albumId: 'itunes-album-1',
    coverArt: '/placeholder-album.svg',
    duration: 30,
    track: 1,
    year: 1993,
    genre: 'Alternative',
    path: '/stream/1',
    bitRate: 0,
    contentType: 'audio/x-m4a',
    suffix: 'm4a',
    size: 0,
    provider: 'Apple Preview',
    sourceUrl: '',
    creatorUrl: '',
    licenseName: '30-second preview',
    licenseUrl: '',
    attributionUrl: '',
    metadataVerified: true,
    ...overrides,
  };
}

function lyrics(overrides: Partial<LyricsResult> = {}): LyricsResult {
  return {
    provider: 'LRCLIB',
    sourceUrl: 'https://lrclib.net/api/get/496',
    trackName: 'Creep',
    artistName: 'Radiohead',
    instrumental: false,
    synced: [
      { time: 10, text: 'first line' },
      { time: 20, text: 'second line' },
      { time: 30, text: 'third line' },
    ],
    plain: 'first line\nsecond line\nthird line',
    ...overrides,
  };
}

let store: PlayerStore;

function Probe() {
  const api = usePlayerStoreApi();
  useEffect(() => {
    store = api;
  }, [api]);
  return null;
}

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MusicCatalogProvider catalog={catalogService}>
      <PlayerStoreProvider initialView="now-playing" initialQuery="">
        <QueryClientProvider client={client}>
          <Probe />
          {children}
        </QueryClientProvider>
      </PlayerStoreProvider>
    </MusicCatalogProvider>
  );
}

function setProgress(seconds: number) {
  act(() => store.getState().setProgress(seconds));
}

/**
 * Lets pending timers run. The panel ignores the scroll events its own
 * `scrollIntoView` produces, and releases that guard on a timer — so a test
 * that wants to act as the reader has to wait for the guard to lift, exactly
 * as a reader would.
 */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  seekSpy.mockClear();
  getLyrics.mockReset();
  // happy-dom implements neither, and the panel calls both.
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('LyricsPanel', () => {
  it('shows the words while it is looking, then the lines it found', async () => {
    getLyrics.mockResolvedValue(lyrics());
    render(
      <Harness>
        <LyricsPanel song={song()} />
      </Harness>,
    );

    expect(screen.getByText('Looking for lyrics…')).toBeInTheDocument();
    expect(await screen.findByText('first line')).toBeInTheDocument();
    expect(screen.getByText('third line')).toBeInTheDocument();
  });

  it('marks the line the track has reached, and only that one', async () => {
    getLyrics.mockResolvedValue(lyrics());
    render(
      <Harness>
        <LyricsPanel song={song()} />
      </Harness>,
    );
    await screen.findByText('first line');

    // Before the first timestamp nothing is current.
    setProgress(5);
    expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(0);

    setProgress(12);
    expect(screen.getByText('first line')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('second line')).not.toHaveAttribute('aria-current');

    setProgress(25);
    expect(screen.getByText('second line')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('first line')).not.toHaveAttribute('aria-current');
  });

  it('seeks to a line when it is clicked', async () => {
    getLyrics.mockResolvedValue(lyrics());
    const user = userEvent.setup();
    render(
      <Harness>
        <LyricsPanel song={song()} />
      </Harness>,
    );

    await user.click(await screen.findByText('second line'));
    expect(seekSpy).toHaveBeenCalledWith(20);
  });

  it('scrolls the current line into view as the track moves', async () => {
    getLyrics.mockResolvedValue(lyrics());
    render(
      <Harness>
        <LyricsPanel song={song()} />
      </Harness>,
    );
    await screen.findByText('first line');

    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    setProgress(12);
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  });

  it('keeps a very large synced document bounded to the lyric viewport', async () => {
    const synced = Array.from({ length: 500 }, (_, index) => ({ time: index * 5, text: `line ${index}` }));
    getLyrics.mockResolvedValue(lyrics({ synced }));
    render(
      <Harness>
        <LyricsPanel song={song({ duration: 2_500 })} />
      </Harness>,
    );

    await screen.findByText('line 0');
    const list = screen.getByRole('list', { name: 'Synced lyrics' });
    expect(list.querySelectorAll('[role="listitem"]').length).toBeLessThanOrEqual(12);
    expect(screen.queryByText('line 499')).not.toBeInTheDocument();
  });

  it('stops following after the reader scrolls, and offers to resume', async () => {
    getLyrics.mockResolvedValue(lyrics());
    const user = userEvent.setup();
    render(
      <Harness>
        <LyricsPanel song={song()} />
      </Harness>,
    );
    await screen.findByText('first line');
    setProgress(12);
    await settle();

    // Reading back up a verse must not be undone by the next line change.
    const list = screen.getByRole('list', { name: 'Synced lyrics' });
    act(() => list.dispatchEvent(new Event('scroll', { bubbles: true })));

    const resume = await screen.findByRole('button', { name: 'Resume following' });
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    setProgress(25);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

    await user.click(resume);
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Resume following' })).not.toBeInTheDocument();
  });

  it('follows again on the next track without being asked', async () => {
    getLyrics.mockResolvedValue(lyrics());
    const { rerender } = render(
      <Harness>
        <LyricsPanel song={song()} />
      </Harness>,
    );
    await screen.findByText('first line');
    await settle();
    act(() =>
      screen.getByRole('list', { name: 'Synced lyrics' }).dispatchEvent(new Event('scroll', { bubbles: true })),
    );
    await screen.findByRole('button', { name: 'Resume following' });

    getLyrics.mockResolvedValue(
      lyrics({
        synced: [
          { time: 5, text: 'a new song' },
          { time: 9, text: 'and more' },
        ],
      }),
    );
    rerender(
      <Harness>
        <LyricsPanel song={song({ id: 'itunes-2' })} />
      </Harness>,
    );

    await screen.findByText('a new song');
    expect(screen.queryByRole('button', { name: 'Resume following' })).not.toBeInTheDocument();
  });

  it('says plainly that no lyrics exist, rather than looking broken', async () => {
    getLyrics.mockResolvedValue(null);
    render(
      <Harness>
        <LyricsPanel song={song()} />
      </Harness>,
    );

    expect(await screen.findByText(/No lyrics found for this track/)).toBeInTheDocument();
  });

  it('tells the reader when the words are not synced instead of pretending they are', async () => {
    getLyrics.mockResolvedValue(lyrics({ synced: [] }));
    render(
      <Harness>
        <LyricsPanel song={song()} />
      </Harness>,
    );

    expect(await screen.findByText(/Unsynced/)).toBeInTheDocument();
    // Plain text is one block, not clickable lines that would seek nowhere.
    expect(screen.queryByRole('button', { name: 'first line' })).not.toBeInTheDocument();
  });

  it('refuses to scroll a full recording’s lyrics against a preview', async () => {
    // Found by playing an Apple chart track: the words are timed from the
    // recording's start, the audio is a thirty-second clip from its middle, so
    // every highlight is wrong and clicking a line seeks somewhere unrelated.
    getLyrics.mockResolvedValue(
      lyrics({
        synced: [
          { time: 19, text: 'first line' },
          { time: 200, text: 'last line' },
        ],
        plain: '',
      }),
    );
    render(
      <Harness>
        <LyricsPanel song={song({ duration: 30 })} />
      </Harness>,
    );

    expect(await screen.findByText(/timed to the full recording/)).toBeInTheDocument();
    // The words are still shown — just as text, not as seekable timed lines.
    expect(screen.queryByRole('button', { name: 'first line' })).not.toBeInTheDocument();
    expect(screen.getByText(/first line/)).toBeInTheDocument();
  });

  it('still scrolls when the document does fit the track', async () => {
    getLyrics.mockResolvedValue(
      lyrics({
        synced: [
          { time: 19, text: 'first line' },
          { time: 200, text: 'last line' },
        ],
      }),
    );
    render(
      <Harness>
        <LyricsPanel song={song({ duration: 240 })} />
      </Harness>,
    );

    expect(await screen.findByRole('button', { name: 'first line' })).toBeInTheDocument();
    expect(screen.queryByText(/timed to the full recording/)).not.toBeInTheDocument();
  });

  it('reports an instrumental track as instrumental', async () => {
    getLyrics.mockResolvedValue(lyrics({ instrumental: true, synced: [], plain: '' }));
    render(
      <Harness>
        <LyricsPanel song={song()} />
      </Harness>,
    );

    expect(await screen.findByText('This track is instrumental.')).toBeInTheDocument();
  });

  it('distinguishes a broken lookup from a track with no lyrics, and can retry', async () => {
    // The panel retries once on its own, so the error state is only reached
    // after both attempts fail — which is what makes it a real failure rather
    // than one dropped packet.
    getLyrics.mockRejectedValue(new Error('upstream'));
    const user = userEvent.setup();
    render(
      <Harness>
        <LyricsPanel song={song()} />
      </Harness>,
    );

    const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 5_000 });
    expect(screen.getByText('The lyrics service could not be reached.')).toBeInTheDocument();
    expect(screen.queryByText(/No lyrics found/)).not.toBeInTheDocument();

    getLyrics.mockResolvedValue(lyrics());
    await user.click(retry);
    expect(await screen.findByText('first line')).toBeInTheDocument();
  });

  it('credits LRCLIB and links to the record it matched', async () => {
    getLyrics.mockResolvedValue(lyrics());
    render(
      <Harness>
        <LyricsPanel song={song()} />
      </Harness>,
    );

    const credit = await screen.findByRole('link', { name: 'LRCLIB' });
    expect(credit).toHaveAttribute('href', 'https://lrclib.net/api/get/496');
    expect(screen.getByText(/matched to/)).toHaveTextContent('Creep');
  });
});

/**
 * A catalog row the user picked often plays as a thirty-second Apple preview
 * that playback silently swaps for a full Kuwo/LX track. Lyrics have to be
 * matched against the *resolved* recording — its title, artist and especially
 * duration — not the catalog row, or LRCLIB has never heard of a thirty-second
 * song and the timed document cannot sync to a clip. The store's
 * `effectiveSong` is the resolved recording; `LyricsPanel` queries against it
 * while keeping the cache key on the catalog id so a re-play reuses the cache.
 */
describe('LyricsPanel against the resolved playback track', () => {
  // A full-track fallback for the `song()` catalog row. Different id, different
  // (longer) duration, same title/artist the LRCLIB record is keyed on.
  function fallback(): Song {
    return song({
      id: 'kuwo-1',
      duration: 240,
      provider: 'Kuwo',
    });
  }

  /**
   * `PlayerStoreProvider` mints a fresh store on mount, so a store reference
   * held before `render()` belongs to nobody. The query fires on mount with
   * whatever `effectiveSong` the live store holds then. To make the panel's
   * *first* fetch use the resolved track, the live store has to be seeded
   * before the panel subscribes — and the only handle on the live store is the
   * `Probe` effect, which runs after the first paint. A `Seeded` wrapper mills
   * the store in its own effect, defers mounting the panel until the seed is
   * down, and so the panel observes the resolved track from the start. No
   * invalidate/refetch dance, no race between the re-render's new `queryFn`
   * closure and the refetch it would trigger.
   */
  function SeededMount({
    catalog,
    seed,
    hideUntilReady = true,
  }: {
    catalog: Song;
    seed: 'fallback' | 'none';
    hideUntilReady?: boolean;
  }) {
    const [ready, setReady] = useState(seed === 'none');
    return (
      <MusicCatalogProvider catalog={catalogService}>
        <PlayerStoreProvider initialView="now-playing" initialQuery="">
          <QueryClientProvider client={seededClient}>
            <Probe />
            {(!hideUntilReady || ready) && <LyricsPanel song={catalog} />}
            <Seeder catalog={catalog} seed={seed} onReady={() => setReady(true)} />
          </QueryClientProvider>
        </PlayerStoreProvider>
      </MusicCatalogProvider>
    );
  }

  function Seeder({ catalog, seed, onReady }: { catalog: Song; seed: 'fallback' | 'none'; onReady: () => void }) {
    const api = usePlayerStoreApi();
    useEffect(() => {
      if (seed === 'fallback') {
        api.getState().playSong(catalog);
        api.getState().setEffectiveSong(fallback());
      }
      onReady();
    }, [api, catalog, seed, onReady]);
    return null;
  }

  // One QueryClient per new-describe test, shared by every mount so a second
  // `SeededMount` of the same catalog served the first mount's cached lyrics.
  let seededClient: QueryClient;

  beforeEach(() => {
    seededClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it('queries LRCLIB with the resolved track, not the catalog row', async () => {
    getLyrics.mockImplementation(async () => lyrics());
    render(<SeededMount catalog={song()} seed="fallback" />);
    // The first fetch carries the effective (resolved) song, including its
    // duration, which is what lets LRCLIB match a full recording rather than a
    // thirty-second clip the database has never heard of.
    await waitFor(() => {
      expect(getLyrics).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'kuwo-1', duration: 240 }),
        expect.anything(),
      );
    });
  });

  it('keeps the cache key on the catalog id so a second pull reuses the cache', async () => {
    const catalog = song();
    getLyrics.mockResolvedValue(lyrics());
    const { unmount } = render(<SeededMount catalog={catalog} seed="fallback" />);
    await screen.findByText('first line');
    expect(getLyrics).toHaveBeenCalledTimes(1);
    const callsAfterFirst = getLyrics.mock.calls.length;

    // A second pull of the same catalog id — the case a re-play is — serves the
    // existing entry from the cache rather than asking LRCLIB again, because the
    // key is the catalog identity, not the resolved track that may differ. The
    // shared `seededClient` is what makes the two mounts share one cache.
    unmount();
    await act(async () => {
      // React Query needs a tick to drop the first observer before mounting the
      // second, or the cache is briefly pinned active and the assertion races.
      await Promise.resolve();
    });
    render(<SeededMount catalog={catalog} seed="fallback" />);
    await screen.findByText('first line');
    expect(getLyrics.mock.calls.length).toBe(callsAfterFirst);
    seededClient.clear();
  });

  it('lets a full-track fallback scroll lyrics the preview duration had to refuse', async () => {
    // The same timed document that the preview (30s) had to show as plain text
    // because its last line runs past 30s. Against the resolved four-minute
    // track, the last line fits and the lyrics scroll in time with playback.
    const resolved = lyrics({
      synced: [
        { time: 19, text: 'first line' },
        { time: 200, text: 'last line' },
      ],
    });
    getLyrics.mockImplementation(async () => resolved);
    render(<SeededMount catalog={song({ duration: 30 })} seed="fallback" />);
    // With the resolved four-minute track as the query identity, the last line
    // (200s) fits inside 240s and the renderer shows seekable timed lines.
    expect(await screen.findByRole('button', { name: 'first line' })).toBeInTheDocument();
    expect(screen.queryByText(/timed to the full recording/)).not.toBeInTheDocument();
  });

  it('falls back to the catalog row when playback did not resolve a full track', async () => {
    // No effectiveSong: the preview *is* what is playing, so the query and the
    // sync check both use the catalog song and its thirty-second duration.
    const catalog = song({ duration: 30 });
    getLyrics.mockResolvedValue(
      lyrics({
        synced: [
          { time: 19, text: 'first line' },
          { time: 200, text: 'last line' },
        ],
        plain: '',
      }),
    );
    render(<SeededMount catalog={catalog} seed="none" />);

    expect(await screen.findByText(/timed to the full recording/)).toBeInTheDocument();
    // The catalog song (30s preview) was queried — LRCLIB never heard the
    // resolved track, because playback never resolved one.
    expect(getLyrics).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'itunes-1', duration: 30 }),
      expect.anything(),
    );
  });
});
