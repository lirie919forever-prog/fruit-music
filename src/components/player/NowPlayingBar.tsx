'use client';

import {
  Heart,
  ListMusic,
  MoreHorizontal,
  Music,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { VolumeSlider } from '@/components/ui/VolumeSlider';
import { useAudio } from '@/components/player/AudioProvider';
import { hasNextInQueue } from '@/components/player/playbackRecovery';
import { CoverArt } from '@/components/ui/CoverArt';
import { PlaybackSourceNotice } from './PlaybackSourceNotice';
import { usePlaybackClock } from './playbackClock';
import type { NavigationItem } from '@/lib/navigation';
import type { ViewType } from '@/types/music';

function formatTime(seconds: number): string {
  if (!seconds || Number.isNaN(seconds)) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

function ControlButton({
  active = false,
  label,
  pressed,
  onClick,
  disabled = false,
  className = '',
  children,
}: {
  active?: boolean;
  label: string;
  pressed?: boolean;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      className={`marea-glass-control flex h-10 w-10 items-center justify-center rounded-full text-[var(--salt-mist)] hover:text-[var(--salt-white)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent lg:h-8 lg:w-8 ${className}`}
      style={{ color: active ? 'var(--salt-primary)' : undefined }}
    >
      {children}
    </motion.button>
  );
}

function SeekSlider({
  duration,
  isLive,
  onSeek,
}: {
  duration: number;
  isLive: boolean;
  onSeek: (time: number) => void;
}) {
  const { progress } = usePlaybackClock();
  const safeProgress = duration > 0 ? Math.max(0, Math.min(Number.isFinite(progress) ? progress : 0, duration)) : 0;
  const progressPct = duration > 0 ? Math.max(0, Math.min(100, (safeProgress / duration) * 100)) : 0;
  const seekable = duration > 0 && !isLive;
  return (
    <div className="group flex w-full max-w-[280px] flex-col gap-1">
      <div className="relative h-6">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--salt-ghost)] transition-all duration-200 group-hover:h-[6px] group-focus-within:h-[6px]">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,var(--salt-bright),var(--salt-primary))]"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0)}
          step={0.1}
          value={Math.max(0, Math.min(Number.isFinite(progress) ? progress : 0, duration || 0))}
          aria-label="Seek"
          disabled={!seekable}
          aria-valuetext={isLive ? 'Live stream' : `${formatTime(progress)} of ${formatTime(duration)}`}
          onChange={(event) => onSeek(Number(event.target.value))}
          className="player-range absolute inset-0"
        />
      </div>
      <div
        className="flex justify-between text-[10px] tabular-nums text-[var(--salt-mist)]"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        <span>{isLive ? 'LIVE' : formatTime(progress)}</span>
        <span>{isLive ? 'LIVE' : formatTime(duration)}</span>
      </div>
    </div>
  );
}

/**
 * A compact seek bar shown only on mobile, below the transport controls.
 * Desktop has the full centered SeekSlider; mobile has no column for it, so
 * this thin strip gives users in-place scrubbing without leaving browse.
 */
function MobileSeekBar({
  duration,
  isLive,
  onSeek,
}: {
  duration: number;
  isLive: boolean;
  onSeek: (time: number) => void;
}) {
  const { progress } = usePlaybackClock();
  const safeProgress = duration > 0 ? Math.max(0, Math.min(Number.isFinite(progress) ? progress : 0, duration)) : 0;
  const progressPct = duration > 0 ? Math.max(0, Math.min(100, (safeProgress / duration) * 100)) : 0;
  const seekable = duration > 0 && !isLive;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[env(safe-area-inset-bottom)] z-10 block px-3 pb-1 md:hidden">
      <div className="relative h-6">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--salt-ghost)]">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,var(--salt-bright),var(--salt-primary))]"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0)}
          step={0.1}
          value={Math.max(0, Math.min(Number.isFinite(progress) ? progress : 0, duration || 0))}
          aria-label="Seek"
          disabled={!seekable}
          aria-valuetext={isLive ? 'Live stream' : `${formatTime(progress)} of ${formatTime(duration)}`}
          onChange={(event) => onSeek(Number(event.target.value))}
          className="player-range pointer-events-auto absolute inset-0"
        />
      </div>
    </div>
  );
}

function MobileMoreControls({
  disabled,
  autoplay,
  onToggleAutoplay,
  repeat,
  onToggleRepeat,
  onOpenLyrics,
  onOpenQueue,
}: {
  disabled: boolean;
  autoplay: boolean;
  onToggleAutoplay: () => void;
  repeat: 'off' | 'all' | 'one';
  onToggleRepeat: () => void;
  onOpenLyrics: () => void;
  onOpenQueue: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative md:hidden">
      <ControlButton
        label={open ? 'Close more controls' : 'Open more controls'}
        pressed={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={17} />
      </ControlButton>
      {open && (
        <div
          role="dialog"
          aria-label="More player controls"
          className="marea-glass-panel absolute bottom-12 right-0 z-20 w-56 rounded-xl border p-3 shadow-xl"
        >
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={onOpenLyrics}
              disabled={disabled}
              className="flex min-h-10 items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-[var(--salt-white)] transition-colors hover:bg-[var(--glass-bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Music className="h-4 w-4 shrink-0 text-[var(--salt-primary)]" aria-hidden />
              Lyrics
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenQueue();
              }}
              disabled={disabled}
              className="flex min-h-10 items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-[var(--salt-white)] transition-colors hover:bg-[var(--glass-bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ListMusic className="h-4 w-4 shrink-0 text-[var(--salt-primary)]" aria-hidden />
              Queue
            </button>
          </div>
          <div className="mt-2 border-t border-[var(--glass-border)] pt-2">
            <span className="mb-1 block px-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--salt-mist)]">
              Volume
            </span>
            <VolumeSlider />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1 border-t border-[var(--glass-border)] pt-2">
            <button
              type="button"
              onClick={onToggleAutoplay}
              disabled={disabled}
              aria-pressed={autoplay}
              className={`flex min-h-10 items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${autoplay ? 'bg-[var(--glass-bg-hover)] text-[var(--salt-primary)]' : 'text-[var(--salt-mist)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-white)]'}`}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Autoplay
            </button>
            <button
              type="button"
              onClick={onToggleRepeat}
              disabled={disabled}
              aria-pressed={repeat !== 'off'}
              className={`flex min-h-10 items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${repeat !== 'off' ? 'bg-[var(--glass-bg-hover)] text-[var(--salt-primary)]' : 'text-[var(--salt-mist)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-white)]'}`}
            >
              {repeat === 'one' ? <Repeat1 className="h-3.5 w-3.5" /> : <Repeat className="h-3.5 w-3.5" />}
              {repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat all' : 'Repeat'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function NowPlayingBar({
  onNavigateWithItem,
  onOpenQueue,
}: {
  onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void;
  onOpenQueue?: () => void;
}) {
  const currentSong = usePlayerStore((s) => s.currentSong);
  const effectiveSong = usePlayerStore((s) => s.effectiveSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playbackIntent = usePlayerStore((s) => s.playbackIntent);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const duration = usePlayerStore((s) => s.duration);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const toggleRepeat = usePlayerStore((s) => s.toggleRepeat);
  const autoplay = usePlayerStore((s) => s.autoplay);
  const toggleAutoplay = usePlayerStore((s) => s.toggleAutoplay);
  const status = usePlayerStore((s) => s.status);
  const error = usePlayerStore((s) => s.error);
  const favorites = usePlayerStore((s) => s.favorites);
  const toggleFavorite = usePlayerStore((s) => s.toggleFavorite);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const setCurrentView = usePlayerStore((s) => s.setCurrentView);
  const setNowPlayingPanel = usePlayerStore((s) => s.setNowPlayingPanel);
  const { seek } = useAudio();
  const isFavorite = currentSong ? favorites.some((song) => song.id === currentSong.id) : false;
  const isLive = currentSong?.isLive === true;

  const hasTrack = Boolean(currentSong);
  const canSeek = hasTrack && duration > 0 && !isLive;
  const isLoading = status === 'loading' && playbackIntent;
  const canGoNext = hasTrack && hasNextInQueue({ queue, queueIndex, shuffle, repeat });
  const playLabel = status === 'error' ? 'Retry playback' : isLoading ? 'Cancel loading' : isPlaying ? 'Pause' : 'Play';
  const openQueue = () => {
    if (onOpenQueue) {
      onOpenQueue();
      return;
    }
    setNowPlayingPanel('queue');
    setCurrentView('now-playing');
  };
  const playIcon = isLoading ? (
    <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
  ) : isPlaying ? (
    <Pause className="h-4 w-4 fill-current" aria-hidden />
  ) : (
    <Play className="ml-0.5 h-4 w-4 fill-current" aria-hidden />
  );

  return (
    <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-50">
      <div
        className="marea-player-surface marea-player-bar relative pointer-events-auto grid min-h-[calc(var(--player-bar-height)_+_env(safe-area-inset-bottom))] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t px-3 md:min-h-[calc(var(--player-bar-desktop-height)_+_env(safe-area-inset-bottom))] md:grid-cols-[minmax(0,260px)_1fr_minmax(0,220px)] md:gap-4 md:px-5"
        style={{
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div aria-live="polite" className="sr-only">
          {currentSong
            ? status === 'error'
              ? `${error || 'Playback failed'} — ${currentSong.title} by ${currentSong.artist}`
              : `${status === 'loading' ? 'Loading' : isPlaying ? 'Playing' : 'Paused'} ${currentSong.title} by ${currentSong.artist}`
            : 'Not playing'}
        </div>

        <div className="flex min-w-0 items-center gap-3">
          {currentSong ? (
            <>
              <CoverArt
                src={currentSong.coverArt}
                alt=""
                sizes="48px"
                loading="eager"
                className="h-12 w-12 shrink-0 rounded-lg object-cover shadow-[0_5px_16px_rgba(25,93,129,0.22)] ring-1 ring-white/60"
              />
              <div className="min-w-0 flex-1">
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setCurrentView('now-playing')}
                  className="block w-full min-w-0 truncate text-left text-[13px] font-medium leading-tight text-[var(--salt-white)] hover:text-[var(--salt-primary)]"
                >
                  {currentSong.title}
                </motion.button>
                <div className="mt-0.5 flex min-w-0 items-center gap-1">
                  {status === 'loading' ? (
                    <p className="min-w-0 flex-1 truncate text-xs leading-tight text-[var(--salt-mist)]">Loading…</p>
                  ) : status === 'error' ? (
                    <p
                      className="min-w-0 flex-1 truncate text-xs leading-tight text-[var(--danger)]"
                      title={error ?? undefined}
                    >
                      {error || 'Playback failed'}
                    </p>
                  ) : onNavigateWithItem ? (
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      type="button"
                      onClick={() => onNavigateWithItem('artists', { kind: 'artist', id: currentSong.artistId })}
                      className="block min-w-0 flex-1 truncate text-left text-xs leading-tight text-[var(--salt-mist)] hover:text-[var(--salt-primary)] focus-visible:outline-none"
                    >
                      {currentSong.artist}
                    </motion.button>
                  ) : (
                    <p className="min-w-0 flex-1 truncate text-xs leading-tight text-[var(--salt-mist)]">
                      {currentSong.artist}
                    </p>
                  )}
                  {status !== 'loading' && status !== 'error' && (
                    <div className="shrink-0 md:hidden">
                      <PlaybackSourceNotice
                        catalogSong={currentSong}
                        effectiveSong={effectiveSong}
                        compact
                        mobileShort
                        verified={
                          (status === 'ready' || status === 'playing' || status === 'paused') &&
                          (duration > 0 || isLive)
                        }
                      />
                    </div>
                  )}
                </div>
                <div className="hidden md:block">
                  <PlaybackSourceNotice
                    catalogSong={currentSong}
                    effectiveSong={effectiveSong}
                    compact
                    verified={
                      (status === 'ready' || status === 'playing' || status === 'paused') && (duration > 0 || isLive)
                    }
                  />
                </div>
              </div>
              <motion.button
                whileTap={{ scale: 0.96 }}
                type="button"
                onClick={() => toggleFavorite(currentSong)}
                aria-label={`${isFavorite ? 'Remove' : 'Add'} ${currentSong.title} ${isFavorite ? 'from' : 'to'} favorites`}
                aria-pressed={isFavorite}
                className={`marea-glass-control hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-base leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] sm:flex ${isFavorite ? 'text-[#d84f5f]' : 'text-[var(--salt-mist)]'}`}
              >
                <Heart className={`h-4 w-4 ${isFavorite ? 'fill-current' : ''}`} aria-hidden />
              </motion.button>
            </>
          ) : (
            <div className="flex items-center gap-3 text-[var(--salt-mist)]">
              <div className="marea-glass-control flex h-12 w-12 items-center justify-center rounded-lg text-[var(--salt-mist)]">
                <Music className="h-5 w-5" aria-hidden />
              </div>
              <span className="whitespace-nowrap text-[13px] max-[359px]:hidden">
                {status === 'error' ? 'Playback unavailable' : 'Not playing'}
              </span>
            </div>
          )}
        </div>

        <div className="hidden min-w-0 flex-col items-center gap-2 md:flex">
          <div className="flex items-center gap-1">
            <ControlButton
              active={shuffle}
              label="Shuffle"
              pressed={shuffle}
              onClick={toggleShuffle}
              disabled={!hasTrack}
            >
              <Shuffle size={14} />
            </ControlButton>
            <ControlButton label="Previous" onClick={previous} disabled={!hasTrack}>
              <SkipBack className="h-[18px] w-[18px] fill-current" aria-hidden />
            </ControlButton>
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={togglePlay}
              disabled={!hasTrack}
              aria-label={playLabel}
              aria-busy={isLoading}
              className="marea-primary-action flex h-10 w-10 items-center justify-center rounded-full text-white disabled:cursor-not-allowed disabled:bg-[#c3ccd2] disabled:shadow-none"
            >
              {playIcon}
            </motion.button>
            <ControlButton label="Next" onClick={next} disabled={!canGoNext}>
              <SkipForward className="h-[18px] w-[18px] fill-current" aria-hidden />
            </ControlButton>
            <ControlButton
              active={repeat !== 'off'}
              label={repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat all' : 'Repeat off'}
              pressed={repeat !== 'off'}
              onClick={toggleRepeat}
              disabled={!hasTrack}
            >
              {repeat === 'one' ? <Repeat1 size={14} /> : <Repeat size={14} />}
            </ControlButton>
            <ControlButton
              active={autoplay}
              label={autoplay ? 'Turn autoplay off' : 'Turn autoplay on'}
              pressed={autoplay}
              onClick={toggleAutoplay}
              disabled={!hasTrack}
            >
              <Sparkles className="h-4 w-4" />
            </ControlButton>
          </div>

          <SeekSlider duration={canSeek ? duration : 0} isLive={isLive} onSeek={seek} />
        </div>

        <div className="flex items-center justify-end gap-1 md:gap-3">
          <div className="flex items-center md:hidden">
            <ControlButton className="max-[359px]:hidden" label="Previous" onClick={previous} disabled={!hasTrack}>
              <SkipBack className="h-[18px] w-[18px] fill-current" aria-hidden />
            </ControlButton>
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={togglePlay}
              disabled={!hasTrack}
              aria-label={playLabel}
              aria-busy={isLoading}
              className="marea-primary-action flex h-10 w-10 items-center justify-center rounded-full text-white disabled:cursor-not-allowed disabled:bg-[#c3ccd2] disabled:shadow-none"
            >
              {playIcon}
            </motion.button>
            <ControlButton className="max-[359px]:hidden" label="Next" onClick={next} disabled={!canGoNext}>
              <SkipForward className="h-[18px] w-[18px] fill-current" aria-hidden />
            </ControlButton>
            <ControlButton className="max-[359px]:hidden" label="Queue" onClick={openQueue} disabled={!hasTrack}>
              <ListMusic size={17} />
            </ControlButton>
            <MobileMoreControls
              disabled={!hasTrack}
              autoplay={autoplay}
              onToggleAutoplay={toggleAutoplay}
              repeat={repeat}
              onToggleRepeat={toggleRepeat}
              onOpenLyrics={() => {
                setNowPlayingPanel('lyrics');
                setCurrentView('now-playing');
              }}
              onOpenQueue={openQueue}
            />
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <VolumeSlider />
            <ControlButton
              label="Lyrics"
              onClick={() => {
                setNowPlayingPanel('lyrics');
                setCurrentView('now-playing');
              }}
              disabled={!hasTrack}
            >
              <Music size={17} />
            </ControlButton>
            <ControlButton label="Queue" onClick={openQueue} disabled={!hasTrack}>
              <ListMusic size={17} />
            </ControlButton>
          </div>
        </div>
        <MobileSeekBar duration={canSeek ? duration : 0} isLive={isLive} onSeek={seek} />
      </div>
    </div>
  );
}
