'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePlayerStore } from '@/store/playerStore';
import { useAudio } from '@/components/player/AudioProvider';
import { api } from '@/lib/api';
import { activeLyricIndex, syncFitsTrack } from '@/lib/lyrics/lrc';
import type { LyricsResult } from '@/lib/lyrics/lrclib';
import type { Song } from '@/types/music';

/**
 * How long the panel stops following the track after the reader scrolls.
 *
 * Without this, scrolling up to re-read a verse is undone by the next line
 * change — which arrives within a couple of seconds — and the panel yanks the
 * reader back. Every player that scrolls lyrics has some version of this pause.
 */
const MANUAL_SCROLL_PAUSE_MS = 6_000;

function LyricsMessage({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 py-10 text-center text-[13px] leading-relaxed text-[var(--salt-mist)]" role="status">
      {children}
    </p>
  );
}

function LyricsCredit({ lyrics }: { lyrics: LyricsResult }) {
  return (
    <p className="border-t border-[var(--glass-border)] px-1 pt-2 text-[11px] text-[var(--salt-mist)]">
      Lyrics contributed by listeners to{' '}
      <a
        href={lyrics.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="underline decoration-transparent underline-offset-2 transition-colors hover:text-[var(--salt-primary)] hover:decoration-current focus-visible:text-[var(--salt-primary)]"
      >
        LRCLIB
      </a>
      , matched to “{lyrics.trackName}” by {lyrics.artistName}
    </p>
  );
}

/**
 * Lyrics for the playing track, scrolling in time with it where LRCLIB has a
 * synced document and standing still where it only has the words.
 */
export function LyricsPanel({ song }: { song: Song }) {
  const { seek } = useAudio();
  const {
    data: lyrics,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['lyrics', song.id],
    queryFn: ({ signal }) => api.getLyrics(song, signal),
    // A track's lyrics do not change while the app is open, and the route
    // already caches the answer. Refetching on remount would only re-ask this
    // server the same question every time the panel is opened.
    staleTime: Infinity,
    retry: 1,
  });

  // Only a document that actually covers this audio is treated as timed. A
  // preview's lyrics are the full recording's, and following them would
  // highlight the wrong line from the first second to the last.
  const timed = lyrics?.synced ?? [];
  const lines = syncFitsTrack(timed, song.duration) ? timed : [];
  // Subscribing to `progress` itself would re-render this panel on every
  // animation frame. Selecting the derived index instead runs a binary search
  // that often, which is nothing, and re-renders only when the line changes.
  const activeIndex = usePlayerStore((state) => activeLyricIndex(lines, state.progress));

  const activeRef = useRef<HTMLButtonElement | null>(null);
  // Which track the reader took manual control of, rather than a bare boolean.
  // Holding the song id means a new track follows again on its own: the pause
  // simply no longer refers to the song on screen. A boolean would need an
  // effect to reset it, and resetting state from an effect is a cascading
  // render — the panel would paint one frame still paused.
  const [pausedFor, setPausedFor] = useState<string | null>(null);
  const following = pausedFor !== song.id;
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set while this component is the one scrolling, so its own smooth scroll
  // does not read as the reader taking over.
  const selfScrollRef = useRef(false);

  useEffect(() => () => void (pauseTimerRef.current && clearTimeout(pauseTimerRef.current)), []);

  useEffect(() => {
    if (!following || activeIndex < 0) return;
    const element = activeRef.current;
    if (!element?.scrollIntoView) return;
    selfScrollRef.current = true;
    const smooth = !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    // Smooth scrolling emits scroll events for a while after the call, so the
    // guard has to outlast the animation rather than be cleared synchronously.
    const release = setTimeout(() => (selfScrollRef.current = false), smooth ? 700 : 0);
    return () => clearTimeout(release);
  }, [activeIndex, following]);

  const resumeFollowing = () => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = null;
    setPausedFor(null);
  };

  const onManualScroll = () => {
    if (selfScrollRef.current) return;
    setPausedFor(song.id);
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(() => setPausedFor(null), MANUAL_SCROLL_PAUSE_MS);
  };

  if (isPending) return <LyricsMessage>Looking for lyrics…</LyricsMessage>;

  if (isError) {
    return (
      <div className="px-3 py-10 text-center">
        <p className="text-[13px] text-[var(--salt-mist)]">The lyrics service could not be reached.</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-3 rounded-full border border-[var(--glass-border)] px-3 py-1 text-[12px] font-semibold text-[var(--salt-primary)] transition-colors hover:bg-[var(--glass-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!lyrics) {
    return (
      <LyricsMessage>
        No lyrics found for this track. Most of this catalog is independent Creative Commons music, which the lyrics
        database rarely holds.
      </LyricsMessage>
    );
  }

  if (lines.length === 0) {
    // A timed document that did not fit still holds the words; falling back to
    // its text beats discarding it because LRCLIB happened to store no plain
    // copy alongside it.
    const words =
      lyrics.plain ||
      timed
        .map((line) => line.text)
        .join('\n')
        .trim();
    if (words === '') {
      return (
        <div>
          <LyricsMessage>
            {lyrics.instrumental ? 'This track is instrumental.' : 'No lyrics found for this track.'}
          </LyricsMessage>
          <LyricsCredit lyrics={lyrics} />
        </div>
      );
    }

    return (
      <div>
        {/* Saying which of the two reasons applies is the difference between a
            panel that looks broken and one that is doing all it can. */}
        <p className="px-1 pb-2 text-[11px] text-[var(--salt-mist)]">
          {timed.length > 0
            ? 'These words are timed to the full recording, which is longer than this clip — shown as text rather than scrolled out of step.'
            : 'Unsynced — these words do not follow the track'}
        </p>
        <div className="max-h-[320px] overflow-y-auto whitespace-pre-wrap px-1 text-[14px] leading-[1.9] text-[var(--salt-white)] lg:max-h-[calc(100dvh-300px)]">
          {words}
        </div>
        <LyricsCredit lyrics={lyrics} />
      </div>
    );
  }

  return (
    <div>
      <div
        onScroll={onManualScroll}
        onWheel={onManualScroll}
        onTouchMove={onManualScroll}
        className="max-h-[320px] overflow-y-auto px-1 lg:max-h-[calc(100dvh-300px)]"
      >
        {lines.map((line, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              key={`${line.time}-${index}`}
              type="button"
              ref={isActive ? activeRef : undefined}
              onClick={() => seek(line.time)}
              // The lyric is the label; a separate one would be read out twice.
              aria-current={isActive ? 'true' : undefined}
              className={`block w-full rounded px-2 py-1.5 text-left text-[15px] leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] ${
                isActive
                  ? 'font-semibold text-[var(--salt-primary)]'
                  : 'text-[var(--salt-mist)] hover:text-[var(--salt-white)]'
              }`}
            >
              {/* A timed blank line is a gap in the words, not a missing line. */}
              {line.text === '' ? <span aria-hidden>♪</span> : line.text}
            </button>
          );
        })}
      </div>
      {!following && (
        <button
          type="button"
          onClick={resumeFollowing}
          className="mt-1 w-full rounded-full bg-[var(--salt-ghost)] px-3 py-1 text-[11px] font-semibold text-[var(--salt-primary)] transition-colors hover:bg-[var(--glass-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
        >
          Resume following
        </button>
      )}
      <LyricsCredit lyrics={lyrics} />
    </div>
  );
}
