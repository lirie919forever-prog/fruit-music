'use client';

import { usePlayerStore } from '@/store/playerStore';
import { useAudio } from '@/components/player/AudioProvider';
import { Attribution } from '@/components/ui/Attribution';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { HiQueueList } from 'react-icons/hi2';

function formatTime(seconds: number): string {
  if (!seconds || Number.isNaN(seconds)) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

function SeekBar({
  progress,
  duration,
  onSeek,
}: {
  progress: number;
  duration: number;
  onSeek: (time: number) => void;
}) {
  const safeProgress = duration > 0 ? Math.max(0, Math.min(Number.isFinite(progress) ? progress : 0, duration)) : 0;
  const pct = duration > 0 ? Math.max(0, Math.min(100, (safeProgress / duration) * 100)) : 0;

  return (
    <div className="group w-full space-y-2">
      <div className="relative h-[2px] rounded-full bg-[var(--pearl-whisper)] transition-all duration-200 group-hover:h-[6px] group-focus-within:h-[6px]">
        <div
          className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,var(--salt-bright),var(--salt-primary))]"
          style={{ width: `${pct}%` }}
        />
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0)}
          step={0.1}
          value={safeProgress}
          disabled={duration <= 0}
          aria-label="Seek"
          aria-valuetext={`${formatTime(progress)} of ${formatTime(duration)}`}
          onChange={(event) => onSeek(Number(event.target.value))}
          className="player-range absolute inset-0"
        />
      </div>
      <div className="flex justify-between text-[11px] tabular-nums text-[var(--pearl-dim)]" style={{ fontFamily: 'var(--font-mono)' }}>
        <span>{formatTime(progress)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}

function PlaybackButton({ onClick, label, disabled = false, children }: { onClick: () => void; label: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="rounded-full p-2 text-[var(--pearl-mid)] transition-colors duration-150 hover:text-[var(--salt-white)] disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}

export function NowPlayingView() {
  const currentSong = usePlayerStore((s) => s.currentSong);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const progress = usePlayerStore((s) => s.progress);
  const duration = usePlayerStore((s) => s.duration);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playbackIntent = usePlayerStore((s) => s.playbackIntent);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const playQueueIndex = usePlayerStore((s) => s.playQueueIndex);
  const status = usePlayerStore((s) => s.status);
  const error = usePlayerStore((s) => s.error);
  const { seek } = useAudio();
  const isLoading = status === 'loading' && playbackIntent;
  const canGoNext = queueIndex !== null && (
    shuffle && queue.length > 1 ||
    queueIndex < queue.length - 1 ||
    repeat === 'all'
  );
  const playLabel = status === 'error' ? 'Retry playback' : isLoading ? 'Cancel loading' : isPlaying ? 'Pause' : 'Play';

  if (!currentSong) {
    return (
      <div className="flex h-full flex-col items-center justify-center py-20 text-[var(--pearl-dim)]">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-4 opacity-40">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
        <p className="text-lg font-semibold text-[var(--pearl-mid)]">No track selected</p>
        <p className="mt-1 text-sm">Choose a verified track from a category or search</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col gap-6 lg:flex-row">
      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-4">
        <div className="relative flex flex-col items-center">
          <img
            src={currentSong.coverArt}
            alt={currentSong.album}
            className="aspect-square w-full max-w-[300px] rounded-[24px] object-cover shadow-[0_48px_100px_color-mix(in_srgb,var(--sea-abyss)_80%,transparent),0_0_0_1px_color-mix(in_srgb,var(--glass-border)_70%,transparent)]"
          />
          <div
            aria-hidden
            className="mt-[-4px] h-[60px] w-full max-w-[300px] rounded-b-[24px] opacity-20"
            style={{
              backgroundImage: `url(${currentSong.coverArt})`,
              backgroundSize: 'cover',
              backgroundPosition: 'bottom',
              transform: 'scaleY(-1)',
              filter: 'blur(4px)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 100%)',
              maskImage: 'linear-gradient(to bottom, black 0%, transparent 100%)',
            }}
          />
        </div>

        <div className="w-full max-w-md px-4 text-center">
          <h2 className="truncate text-3xl font-bold tracking-tight text-white">{currentSong.title}</h2>
          <p className="mt-2 text-[13px] font-semibold uppercase tracking-[0.18em] text-[var(--salt-primary)]">{currentSong.artist}</p>
          <p className="mt-1 text-sm text-[var(--salt-mist)]">{currentSong.album}</p>
          <div className="mt-3"><Attribution song={currentSong} /></div>
          <p className="mt-2 text-xs text-[var(--salt-mist)]" role="status">
            {status === 'loading' ? 'Loading verified audio…' : status === 'error' ? error : null}
          </p>
        </div>

        <div className="w-full max-w-md px-4">
          <SeekBar progress={progress} duration={duration} onSeek={seek} />
        </div>

        <div className="flex items-center gap-5">
          <PlaybackButton onClick={previous} label="Previous">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
          </PlaybackButton>
          <button
            onClick={togglePlay}
            aria-label={playLabel}
            aria-busy={isLoading}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--salt-primary)] text-[var(--sea-abyss)] shadow-[0_0_24px_var(--glow-strong)] transition-transform duration-150 hover:scale-[1.02]"
          >
            {isLoading ? (
              <span aria-hidden className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : isPlaying ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>
          <PlaybackButton onClick={next} label="Next" disabled={!canGoNext}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
          </PlaybackButton>
        </div>
      </div>

      <GlassPanel className="w-full space-y-4 px-4 py-4 lg:w-80" hover>
        <div className="flex items-center gap-2 text-sm text-[var(--salt-mist)]">
          <HiQueueList className="h-4 w-4" />
          <span>Up Next ({queue.length})</span>
        </div>
        <div className="max-h-[300px] space-y-1 overflow-y-auto rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2 backdrop-blur-xl">
          {queue.map((item, index) => (
            <button
              type="button"
              onClick={() => playQueueIndex(index)}
              aria-current={index === queueIndex ? 'true' : undefined}
              key={`${item.song.id}-${index}`}
              className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm transition-colors hover:bg-[var(--glass-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
              style={{
                background: index === queueIndex ? 'var(--glass-bg-hover)' : 'transparent',
                borderLeft: index === queueIndex ? '2px solid var(--salt-primary)' : '2px solid transparent',
                color: index === queueIndex ? 'var(--salt-white)' : 'var(--salt-mist)',
              }}
            >
              <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-[var(--salt-mist)]" style={{ fontFamily: 'var(--font-mono)' }}>
                {index + 1}
              </span>
              <img src={item.song.coverArt} alt="" className="h-7 w-7 shrink-0 rounded-md object-cover" />
              <span className="flex-1 truncate">{item.song.title}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-[var(--salt-mist)]" style={{ fontFamily: 'var(--font-mono)' }}>
                {formatTime(item.song.duration)}
              </span>
            </button>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
