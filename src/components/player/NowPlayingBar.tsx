'use client';

import { usePlayerStore } from '@/store/playerStore';
import { VolumeSlider } from '@/components/ui/VolumeSlider';
import { useAudio } from '@/components/player/AudioProvider';
import { BsShuffle, BsRepeat, BsRepeat1 } from 'react-icons/bs';
import { HiQueueList } from 'react-icons/hi2';

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
  children,
}: {
  active?: boolean;
  label: string;
  pressed?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-[var(--salt-mist)] transition-colors duration-150 hover:border-[var(--glass-border)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[var(--salt-white)] disabled:cursor-not-allowed disabled:opacity-35"
      style={{ color: active ? 'var(--salt-primary)' : undefined }}
    >
      {children}
    </button>
  );
}

function SeekSlider({
  progressPct,
  progress,
  duration,
  onSeek,
}: {
  progressPct: number;
  progress: number;
  duration: number;
  onSeek: (time: number) => void;
}) {
  return (
    <div className="group flex w-full max-w-[280px] flex-col gap-1">
      <div className="relative h-[2px] rounded-full bg-[var(--salt-ghost)] transition-all duration-200 group-hover:h-[6px] group-focus-within:h-[6px]">
        <div
          className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,var(--salt-bright),var(--salt-primary))]"
          style={{ width: `${progressPct}%` }}
        />
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0)}
          step={0.1}
          value={Math.max(0, Math.min(Number.isFinite(progress) ? progress : 0, duration || 0))}
          aria-label="Seek"
          disabled={duration <= 0}
          aria-valuetext={`${formatTime(progress)} of ${formatTime(duration)}`}
          onChange={(event) => onSeek(Number(event.target.value))}
          className="player-range absolute inset-0"
        />
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-[var(--salt-mist)]" style={{ fontFamily: 'var(--font-mono)' }}>
        <span>{formatTime(progress)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}

export function NowPlayingBar() {
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playbackIntent = usePlayerStore((s) => s.playbackIntent);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const progress = usePlayerStore((s) => s.progress);
  const duration = usePlayerStore((s) => s.duration);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const toggleRepeat = usePlayerStore((s) => s.toggleRepeat);
  const status = usePlayerStore((s) => s.status);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const setCurrentView = usePlayerStore((s) => s.setCurrentView);
  const { seek } = useAudio();

  const safeProgress = duration > 0 ? Math.max(0, Math.min(Number.isFinite(progress) ? progress : 0, duration)) : 0;
  const progressPct = duration > 0 ? Math.max(0, Math.min(100, (safeProgress / duration) * 100)) : 0;
  const hasTrack = Boolean(currentSong);
  const canSeek = hasTrack && duration > 0;
  const isLoading = status === 'loading' && playbackIntent;
  const canGoNext = hasTrack && queueIndex !== null && (
    shuffle && queue.length > 1 ||
    queueIndex < queue.length - 1 ||
    repeat === 'all'
  );
  const playLabel = status === 'error' ? 'Retry playback' : isLoading ? 'Cancel loading' : isPlaying ? 'Pause' : 'Play';
  const playIcon = isLoading ? (
    <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
  ) : isPlaying ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5" aria-hidden><path d="M8 5v14l11-7z" /></svg>
  );

  return (
    <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-50">
      <div
        className="pointer-events-auto grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-[var(--glass-border)] bg-[rgba(2,8,16,0.78)] px-3 backdrop-blur-3xl shadow-[0_-12px_40px_rgba(2,8,16,0.42)] md:grid-cols-[minmax(0,260px)_1fr_minmax(0,220px)] md:gap-4 md:px-5"
        style={{ minHeight: 'calc(72px + env(safe-area-inset-bottom))', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div
          aria-live="polite"
          className="sr-only"
        >
          {currentSong
            ? `${status === 'loading' ? 'Loading' : status === 'error' ? 'Playback failed for' : isPlaying ? 'Playing' : 'Paused'} ${currentSong.title} by ${currentSong.artist}`
            : 'Not playing'}
        </div>

        <div className="flex min-w-0 items-center gap-3">
          {currentSong ? (
            <>
              <img
                src={currentSong.coverArt}
                alt={currentSong.album}
                className="h-12 w-12 shrink-0 rounded-xl object-cover shadow-[0_12px_28px_rgba(2,8,16,0.35)]"
              />
              <div className="min-w-0">
                <button
                  onClick={() => setCurrentView('now-playing')}
                  className="block max-w-[180px] truncate text-left text-sm font-semibold text-white"
                >
                  {currentSong.title}
                </button>
                <p className="max-w-[180px] truncate text-xs text-[var(--salt-foam)]">
                  {status === 'loading' ? 'Loading…' : status === 'error' ? 'Playback failed' : currentSong.artist}
                </p>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3 text-[var(--salt-foam)]">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[rgba(255,255,255,0.05)]">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </div>
              <span className="text-sm">{status === 'error' ? 'Playback unavailable' : 'Not playing'}</span>
            </div>
          )}
        </div>

        <div className="hidden min-w-0 flex-col items-center gap-2 md:flex">
          <div className="flex items-center gap-1">
            <ControlButton active={shuffle} label="Shuffle" pressed={shuffle} onClick={toggleShuffle} disabled={!hasTrack}>
              <BsShuffle size={14} />
            </ControlButton>
            <ControlButton label="Previous" onClick={previous} disabled={!hasTrack}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
            </ControlButton>
            <button
              onClick={togglePlay}
              disabled={!hasTrack}
              aria-label={playLabel}
              aria-busy={isLoading}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--salt-primary)] text-[var(--sea-abyss)] shadow-[0_0_24px_rgba(91,184,245,0.35)] transition-transform duration-150 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:scale-100"
            >
              {playIcon}
            </button>
            <ControlButton label="Next" onClick={next} disabled={!canGoNext}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
            </ControlButton>
            <ControlButton active={repeat !== 'off'} label={repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat all' : 'Repeat off'} pressed={repeat !== 'off'} onClick={toggleRepeat} disabled={!hasTrack}>
              {repeat === 'one' ? <BsRepeat1 size={14} /> : <BsRepeat size={14} />}
            </ControlButton>
          </div>

          <SeekSlider progressPct={progressPct} progress={progress} duration={canSeek ? duration : 0} onSeek={seek} />
        </div>

        <div className="flex items-center justify-end gap-1 md:gap-3">
          <div className="flex items-center md:hidden">
            <ControlButton label="Previous" onClick={previous} disabled={!hasTrack}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
            </ControlButton>
            <button
              onClick={togglePlay}
              disabled={!hasTrack}
              aria-label={playLabel}
              aria-busy={isLoading}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--salt-primary)] text-[var(--sea-abyss)] disabled:cursor-not-allowed disabled:opacity-35"
            >
              {isLoading ? <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : isPlaying ? <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg> : <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>}
            </button>
            <ControlButton label="Next" onClick={next} disabled={!canGoNext}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
            </ControlButton>
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <VolumeSlider />
            <ControlButton label="Queue" onClick={() => setCurrentView('now-playing')} disabled={!hasTrack}>
              <HiQueueList size={17} />
            </ControlButton>
          </div>
        </div>
      </div>
    </div>
  );
}
