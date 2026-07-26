/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlayerStoreProvider, usePlayerStoreApi, type PlayerStore } from '@/store/playerStore';
import { LyricsPanel } from './LyricsPanel';
import type { LyricsResult } from '@/lib/lyrics/lrclib';
import type { Song } from '@/types/music';

const seekSpy = vi.fn();
vi.mock('@/components/player/AudioProvider', () => ({
  useAudio: () => ({ seek: seekSpy, stop: () => {}, getHowl: () => null }),
}));

const getLyrics = vi.fn<(song: Song, signal?: AbortSignal) => Promise<LyricsResult | null>>();
vi.mock('@/lib/api', () => ({ api: { getLyrics: (...args: [Song]) => getLyrics(...args) } }));

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
    <PlayerStoreProvider initialView="now-playing" initialQuery="">
      <QueryClientProvider client={client}>
        <Probe />
        {children}
      </QueryClientProvider>
    </PlayerStoreProvider>
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
    const list = screen.getByText('first line').parentElement!;
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
    act(() => screen.getByText('first line').parentElement!.dispatchEvent(new Event('scroll', { bubbles: true })));
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
