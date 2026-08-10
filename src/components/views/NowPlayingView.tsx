'use client';

import { ExternalLink, Heart, Music, ListMusic, Signal, Sparkles, Shuffle, Repeat, Repeat1 } from 'lucide-react';
import React from 'react';
import { motion } from 'motion/react';
import { usePlayerStore } from '@/store/playerStore';
import { useAudio } from '@/components/player/AudioProvider';
import { LyricsPanel } from '@/components/player/LyricsPanel';
import { SleepTimer } from '@/components/player/SleepTimer';
import { hasNextInQueue } from '@/components/player/playbackRecovery';
import { Attribution } from '@/components/ui/Attribution';
import { CoverArt } from '@/components/ui/CoverArt';
import { VirtualList } from '@/components/ui/VirtualList';
import { PlaybackSourceNotice } from '@/components/player/PlaybackSourceNotice';
import { AudioAccessBadge } from './SongCard';
import type { NavigationItem } from '@/lib/navigation';
import type { ViewType } from '@/types/music';
import { usePlaybackClock } from '@/components/player/playbackClock';

function formatTime(seconds: number): string {
  if (!seconds || Number.isNaN(seconds)) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

function SeekBar({ duration, isLive, onSeek }: { duration: number; isLive: boolean; onSeek: (time: number) => void }) {
  const { progress } = usePlaybackClock();
  const seekable = duration > 0 && !isLive;
  const safeProgress = seekable ? Math.max(0, Math.min(Number.isFinite(progress) ? progress : 0, duration)) : 0;
  const pct = seekable ? Math.max(0, Math.min(100, (safeProgress / duration) * 100)) : 0;

  return (
    <div className="group w-full space-y-2">
      <div className="relative h-6">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--pearl-whisper)] transition-all duration-200 group-hover:h-[6px] group-focus-within:h-[6px]">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,var(--salt-bright),var(--salt-primary))]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0)}
          step={0.1}
          value={safeProgress}
          disabled={!seekable}
          aria-label="Seek"
          aria-valuetext={isLive ? 'Live stream' : `${formatTime(progress)} of ${formatTime(duration)}`}
          onChange={(event) => onSeek(Number(event.target.value))}
          className="player-range absolute inset-0"
        />
      </div>
      <div
        className="flex justify-between text-[11px] tabular-nums text-[var(--pearl-dim)]"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        <span>{isLive ? 'LIVE' : formatTime(progress)}</span>
        <span>{isLive ? 'LIVE' : formatTime(duration)}</span>
      </div>
    </div>
  );
}

function PlaybackButton({
  onClick,
  label,
  disabled = false,
  active = false,
  pressed,
  children,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  active?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 420, damping: 26 }}
      className="rounded-full p-2 transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-primary)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
      style={{ color: active ? 'var(--salt-primary)' : 'var(--pearl-mid)' }}
    >
      {children}
    </motion.button>
  );
}

type Panel = 'queue' | 'lyrics';

function PanelTab({
  id,
  selected,
  onSelect,
  icon,
  children,
}: {
  id: Panel;
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={selected}
      aria-controls={`panel-${id}`}
      // Only the selected tab is in the tab order; the arrow keys move between
      // them. This is the roving-tabindex pattern the tablist role requires,
      // and without it a keyboard lands on every tab on the way to the panel.
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const other = document.getElementById(`tab-${id === 'queue' ? 'lyrics' : 'queue'}`);
        (other as HTMLButtonElement | null)?.focus();
        (other as HTMLButtonElement | null)?.click();
      }}
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] ${
        selected
          ? 'bg-[var(--salt-ghost)] text-[var(--salt-white)]'
          : 'text-[var(--salt-mist)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-white)]'
      }`}
    >
      <span aria-hidden className={selected ? 'text-[var(--salt-primary)]' : 'text-[var(--salt-mist)]'}>
        {icon}
      </span>
      {children}
    </button>
  );
}

export function NowPlayingView({
  onNavigateWithItem,
}: {
  onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void;
}) {
  const currentSong = usePlayerStore((s) => s.currentSong);
  const effectiveSong = usePlayerStore((s) => s.effectiveSong);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const duration = usePlayerStore((s) => s.duration);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playbackIntent = usePlayerStore((s) => s.playbackIntent);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const playQueueIndex = usePlayerStore((s) => s.playQueueIndex);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const toggleRepeat = usePlayerStore((s) => s.toggleRepeat);
  const autoplay = usePlayerStore((s) => s.autoplay);
  const toggleAutoplay = usePlayerStore((s) => s.toggleAutoplay);
  const status = usePlayerStore((s) => s.status);
  const error = usePlayerStore((s) => s.error);
  const favorites = usePlayerStore((s) => s.favorites);
  const toggleFavorite = usePlayerStore((s) => s.toggleFavorite);
  const { seek } = useAudio();
  const isLive = currentSong?.isLive === true;
  // The store is the single source of truth so the player bar and global
  // shortcuts can select a tab while this view is already mounted.
  const preferredPanel = usePlayerStore((s) => s.nowPlayingPanel);
  const setNowPlayingPanel = usePlayerStore((s) => s.setNowPlayingPanel);
  const panel = preferredPanel;
  const selectPanel = (nextPanel: Panel) => {
    setNowPlayingPanel(nextPanel);
  };
  const isFavorite = currentSong ? favorites.some((song) => song.id === currentSong.id) : false;
  const isLoading = status === 'loading' && playbackIntent;
  const canGoNext = hasNextInQueue({ queue, queueIndex, shuffle, repeat });
  const playLabel = status === 'error' ? 'Retry playback' : isLoading ? 'Cancel loading' : isPlaying ? 'Pause' : 'Play';

  if (!currentSong) {
    return (
      <div className="flex h-full flex-col items-center justify-center py-20 text-[var(--pearl-dim)]">
        <svg
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mb-4 opacity-40"
        >
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
        <p className="text-[17px] font-bold text-[var(--pearl-mid)]">No track selected</p>
        <p className="mt-1 text-[13px]">Choose a verified track from a category or search</p>
      </div>
    );
  }

  const playbackSong = effectiveSong ?? currentSong;
  const playbackVerified =
    (status === 'ready' || status === 'playing' || status === 'paused') && (duration > 0 || isLive);
  const playbackSourceUrl = playbackSong.sourceUrl || currentSong.sourceUrl;

  return (
    <div className="relative flex min-h-full flex-col gap-7 pb-8 lg:flex-row lg:gap-8">
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-2 py-4 sm:px-6 lg:py-6">
        <div className="flex w-full max-w-xl items-center justify-between gap-3 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--salt-primary)] sm:px-0">
          <span className="flex items-center gap-1.5">
            {isLive && <Signal className="h-3.5 w-3.5" aria-hidden />}
            {isLive ? 'Live now' : 'Now playing'}
          </span>
          <span className="text-[var(--salt-mist)]">{playbackSong.provider}</span>
        </div>
        {/* No mirrored reflection under the artwork: besides dating the view, it
            set the cover as a raw CSS `url()`, which skipped the host allowlist
            and escaping that every other image goes through. */}
        <CoverArt
          src={currentSong.coverArt}
          alt=""
          sizes="(max-width: 640px) 82vw, (max-width: 1200px) 46vw, 460px"
          loading="eager"
          style={{ maxWidth: 'min(420px, 32dvh)' }}
          className="aspect-square w-full max-w-[420px] rounded-xl object-cover shadow-[0_24px_70px_rgba(39,101,137,0.24)]"
        />

        <div className="w-full max-w-xl px-4 text-center">
          <h2 className="line-clamp-2 max-w-full break-words text-[26px] font-bold leading-tight tracking-[-0.02em] text-[var(--salt-white)] sm:line-clamp-none sm:truncate sm:text-[32px]">
            {currentSong.title}
          </h2>
          {onNavigateWithItem ? (
            <button
              type="button"
              onClick={() => onNavigateWithItem('artists', { kind: 'artist', id: currentSong.artistId })}
              className="mt-1 max-w-full truncate text-[17px] text-[var(--salt-primary)] underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current focus-visible:outline-none"
            >
              {currentSong.artist}
            </button>
          ) : (
            <p className="mt-1 truncate text-[17px] text-[var(--salt-primary)]">{currentSong.artist}</p>
          )}
          {/* Singles come back with the album named after the track, and
              repeating the title verbatim one line below it reads as a bug. */}
          {currentSong.album && currentSong.album !== currentSong.title && (
            <p className="mt-0.5 truncate text-[13px] text-[var(--salt-mist)]">{currentSong.album}</p>
          )}
          <div className="mt-3">
            <Attribution song={currentSong} />
            <div className="mt-2">
              <PlaybackSourceNotice
                catalogSong={currentSong}
                effectiveSong={effectiveSong}
                verified={playbackVerified}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <AudioAccessBadge song={playbackSong} />
              {playbackSourceUrl && (
                <a
                  href={playbackSourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--salt-primary)] underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current focus-visible:outline-none"
                >
                  Open source
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              )}
            </div>
          </div>
          {status === 'error' ? (
            <p className="mt-2 text-xs text-[var(--danger)]" role="status">
              {error}
            </p>
          ) : (
            <p className="mt-2 text-xs text-[var(--salt-mist)]" role="status">
              {status === 'loading' ? 'Loading verified audio…' : null}
            </p>
          )}
        </div>

        <div className="w-full max-w-xl px-4">
          <SeekBar duration={duration} isLive={isLive} onSeek={seek} />
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <PlaybackButton onClick={toggleShuffle} label="Shuffle" active={shuffle} pressed={shuffle}>
            <Shuffle size={20} />
          </PlaybackButton>
          <PlaybackButton onClick={previous} label="Previous">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
            </svg>
          </PlaybackButton>
          <motion.button
            onClick={togglePlay}
            aria-label={playLabel}
            aria-busy={isLoading}
            whileTap={{ scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 480, damping: 22 }}
            className="marea-primary-action flex h-16 w-16 items-center justify-center rounded-full text-white"
          >
            {isLoading ? (
              <span
                aria-hidden
                className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            ) : isPlaying ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </motion.button>
          <PlaybackButton onClick={next} label="Next" disabled={!canGoNext}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            </svg>
          </PlaybackButton>
          <PlaybackButton
            onClick={toggleRepeat}
            label={repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat all' : 'Repeat off'}
            active={repeat !== 'off'}
            pressed={repeat !== 'off'}
          >
            {repeat === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}
          </PlaybackButton>
          <PlaybackButton
            onClick={() => toggleFavorite(currentSong)}
            label={`${isFavorite ? 'Remove' : 'Add'} ${currentSong.title} ${isFavorite ? 'from' : 'to'} favorites`}
            active={isFavorite}
            pressed={isFavorite}
          >
            {isFavorite ? (
              <Heart className="h-5 w-5 fill-current" aria-hidden />
            ) : (
              <Heart className="h-5 w-5" aria-hidden />
            )}
          </PlaybackButton>
          <PlaybackButton
            onClick={toggleAutoplay}
            label={autoplay ? 'Turn autoplay off' : 'Turn autoplay on'}
            active={autoplay}
            pressed={autoplay}
          >
            <Sparkles className="h-5 w-5" />
          </PlaybackButton>
        </div>

        <SleepTimer />
      </div>

      {/* `self-start` keeps the panel the height of its contents: as a stretched
          flex child it drew an empty white column down the rest of the page. */}
      <div
        data-marea-lyrics-panel
        className="marea-glass-panel w-full shrink-0 self-start rounded-2xl border px-3 py-3 lg:w-[380px]"
      >
        <div className="flex items-center justify-between gap-2 pb-1">
          <div role="tablist" aria-label="Now playing panels" className="flex items-center gap-1">
            <PanelTab
              id="queue"
              selected={panel === 'queue'}
              onSelect={() => selectPanel('queue')}
              icon={<ListMusic className="h-4 w-4" />}
            >
              Up Next ({queue.length})
            </PanelTab>
            <PanelTab
              id="lyrics"
              selected={panel === 'lyrics'}
              onSelect={() => selectPanel('lyrics')}
              icon={<Music className="h-4 w-4" />}
            >
              Lyrics
            </PanelTab>
          </div>
          {panel === 'queue' && queue.length > 1 && (
            <button
              type="button"
              onClick={clearQueue}
              className="rounded-full px-2 py-1 text-[11px] font-semibold text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-primary)]"
            >
              Clear
            </button>
          )}
        </div>
        <div id="panel-lyrics" role="tabpanel" aria-labelledby="tab-lyrics" hidden={panel !== 'lyrics'}>
          {/* Mounted only while shown, so opening the tab is what asks for the
              lyrics — the whole catalog does not get looked up in the
              background for a panel nobody opened. */}
          {panel === 'lyrics' && <LyricsPanel song={currentSong} />}
        </div>
        <div
          id="panel-queue"
          role="tabpanel"
          aria-labelledby="tab-queue"
          hidden={panel !== 'queue'}
          className="max-h-[320px] overflow-y-auto lg:max-h-[calc(100dvh-260px)]"
        >
          {queue.length ? (
            <VirtualList
              items={queue}
              estimateSize={52}
              label="Full player queue"
              getItemKey={(item, index) => `${item.song.id}-${index}`}
              className="max-h-[320px] lg:max-h-[calc(100dvh-260px)]"
              renderItem={(item, index) => (
                <div
                  className="flex items-center gap-1 border-b border-[var(--glass-border)] last:border-b-0"
                  style={{ background: index === queueIndex ? 'var(--glass-bg-hover)' : 'transparent' }}
                >
                  <button
                    type="button"
                    onClick={() => playQueueIndex(index)}
                    aria-current={index === queueIndex ? 'true' : undefined}
                    className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded px-1 text-left text-[13px] transition-colors hover:bg-[var(--glass-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
                    style={{ color: index === queueIndex ? 'var(--salt-primary)' : 'var(--salt-white)' }}
                  >
                    <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-[var(--salt-mist)]">
                      {index + 1}
                    </span>
                    <CoverArt
                      src={item.song.coverArt}
                      alt=""
                      sizes="32px"
                      className="h-8 w-8 shrink-0 rounded object-cover"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.song.title}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-[var(--salt-mist)]">
                        {item.song.artist}
                      </span>
                    </span>
                    <AudioAccessBadge song={item.song} />
                    <span className="shrink-0 text-[11px] tabular-nums text-[var(--salt-mist)]">
                      {item.song.isLive ? 'LIVE' : formatTime(item.song.duration)}
                    </span>
                  </button>
                  {/* No favorite control here: at this panel's width six actions
                  squeeze the title down to a few characters. The queue exists
                  to reorder and remove, and favoriting the playing track is
                  one reach away in the transport row above. */}
                  <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => reorderQueue(index, index - 1)}
                      disabled={index === 0}
                      aria-label={`Move ${item.song.title} earlier`}
                      className="h-7 w-6 rounded text-xs text-[var(--salt-mist)] hover:bg-[var(--salt-ghost)] disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => reorderQueue(index, index + 1)}
                      disabled={index === queue.length - 1}
                      aria-label={`Move ${item.song.title} later`}
                      className="h-7 w-6 rounded text-xs text-[var(--salt-mist)] hover:bg-[var(--salt-ghost)] disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFromQueue(index)}
                      aria-label={`Remove ${item.song.title} from queue`}
                      className="h-7 w-6 rounded text-sm text-[var(--salt-mist)] hover:bg-[var(--salt-ghost)]"
                    >
                      ×
                    </button>
                  </div>
                </div>
              )}
            />
          ) : (
            <p className="px-3 py-8 text-center text-[13px] text-[var(--salt-mist)]">
              Your queue is empty. Choose a verified track to add it here.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
