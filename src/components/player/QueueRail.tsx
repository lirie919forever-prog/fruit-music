'use client';

import {
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  ListMusic,
  Play,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { usePlayerStore } from '@/store/playerStore';
import { CoverArt } from '@/components/ui/CoverArt';
import { VirtualList } from '@/components/ui/VirtualList';
import type { QueuePanelMode } from '@/lib/appSettings';
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

/**
 * The desktop queue stays beside the content so playback order is visible while
 * browsing. Mobile keeps the modal QueueDrawer because a permanent third column
 * would leave too little room for the catalog and transport controls.
 */
export function QueueRail({
  mode,
  onModeChange,
  onOpenFullPlayer,
}: {
  mode: QueuePanelMode;
  onModeChange: (mode: QueuePanelMode) => void;
  onOpenFullPlayer: () => void;
}) {
  const queue = usePlayerStore((state) => state.queue);
  const queueIndex = usePlayerStore((state) => state.queueIndex);
  const currentSong = usePlayerStore((state) => state.currentSong);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const removeFromQueue = usePlayerStore((state) => state.removeFromQueue);
  const reorderQueue = usePlayerStore((state) => state.reorderQueue);
  const playQueueIndex = usePlayerStore((state) => state.playQueueIndex);
  const clearQueue = usePlayerStore((state) => state.clearQueue);
  const autoplay = usePlayerStore((state) => state.autoplay);
  const toggleAutoplay = usePlayerStore((state) => state.toggleAutoplay);

  if (mode === 'hidden') {
    return (
      <div className="pointer-events-none fixed right-0 top-1/2 z-40 hidden -translate-y-1/2 lg:block">
        <motion.button
          whileTap={{ scale: 0.96 }}
          type="button"
          onClick={() => onModeChange('expanded')}
          aria-label="Show queue"
          title="Show queue"
          className="marea-glass-surface pointer-events-auto flex h-24 w-7 items-center justify-center rounded-l-xl border border-r-0 text-[var(--salt-mist)] transition-[width,color] hover:w-9 hover:text-[var(--salt-primary)]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </motion.button>
      </div>
    );
  }

  if (mode === 'collapsed') {
    return (
      <aside
        aria-label="Collapsed playback queue"
        className="marea-glass-sidebar hidden h-full min-h-0 w-[72px] shrink-0 flex-col border-l transition-[width,opacity] duration-300 lg:flex"
        style={{ paddingBottom: 'var(--player-bar-clearance)' }}
      >
        <header className="flex shrink-0 flex-col items-center gap-2 border-b border-[var(--glass-border)] px-2 py-4">
          <motion.button
            whileTap={{ scale: 0.96 }}
            type="button"
            onClick={() => onModeChange('expanded')}
            aria-label="Expand queue"
            title="Expand queue"
            className="marea-glass-control flex h-8 w-8 items-center justify-center rounded-lg text-[var(--salt-mist)] hover:text-[var(--salt-primary)]"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </motion.button>
          <span className="marea-glass-control relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg">
            {currentSong ? (
              <CoverArt
                src={currentSong.coverArt}
                alt=""
                sizes="40px"
                loading="eager"
                className="h-full w-full object-cover"
              />
            ) : (
              <ListMusic className="h-5 w-5 text-[var(--salt-mist)]" aria-hidden />
            )}
            {isPlaying && (
              <span className="absolute bottom-1 right-1 h-2 w-2 rounded-full bg-[#d84f5f]" aria-label="Playing" />
            )}
          </span>
          <span className="text-[11px] font-bold tabular-nums text-[var(--salt-primary)]">{queue.length}</span>
        </header>
        <div className="flex min-h-0 flex-1 flex-col items-center gap-3 py-4">
          <motion.button
            whileTap={{ scale: 0.96 }}
            type="button"
            onClick={onOpenFullPlayer}
            aria-label="Open full player"
            title="Open full player"
            className="marea-primary-action flex h-9 w-9 items-center justify-center rounded-full text-white"
          >
            <Play className="h-4 w-4" aria-hidden />
          </motion.button>
          <span className="h-px w-8 bg-[var(--glass-border)]" aria-hidden />
          <motion.button
            whileTap={{ scale: 0.96 }}
            type="button"
            onClick={clearQueue}
            disabled={queue.length === 0}
            aria-label="Clear queue"
            title="Clear queue"
            className="marea-glass-control flex h-8 w-8 items-center justify-center rounded-lg text-[var(--salt-mist)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </motion.button>
        </div>
        <footer className="flex shrink-0 flex-col items-center gap-2 border-t border-[var(--glass-border)] px-2 py-3">
          <motion.button
            whileTap={{ scale: 0.96 }}
            type="button"
            onClick={() => onModeChange('hidden')}
            aria-label="Hide queue"
            title="Hide queue"
            className="marea-glass-control flex h-8 w-8 items-center justify-center rounded-lg text-[var(--salt-mist)] hover:text-[var(--salt-primary)]"
          >
            <EyeOff className="h-4 w-4" aria-hidden />
          </motion.button>
        </footer>
      </aside>
    );
  }

  return (
    <aside
      aria-labelledby="queue-rail-title"
      className="marea-glass-sidebar hidden h-full min-h-0 w-[min(30vw,320px)] shrink-0 flex-col border-l lg:flex"
      style={{ paddingBottom: 'var(--player-bar-clearance)' }}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--glass-border)] px-4 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="marea-glass-control flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--salt-primary)]">
            <ListMusic className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="queue-rail-title" className="truncate text-[15px] font-bold text-[var(--salt-white)]">
              Up next
            </h2>
            <p className="mt-0.5 text-[11px] text-[var(--salt-mist)]">
              {queue.length} {queue.length === 1 ? 'track' : 'tracks'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <motion.button
            whileTap={{ scale: 0.96 }}
            type="button"
            onClick={() => onModeChange('collapsed')}
            aria-label="Collapse queue"
            title="Collapse queue"
            className="marea-glass-control flex h-8 w-8 items-center justify-center rounded-lg text-[var(--salt-mist)] hover:text-[var(--salt-primary)]"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.96 }}
            type="button"
            onClick={onOpenFullPlayer}
            aria-label="Open full player"
            title="Open full player"
            className="marea-glass-control flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--salt-mist)] hover:text-[var(--salt-primary)]"
          >
            <Play className="h-4 w-4" aria-hidden />
          </motion.button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {queue.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <ListMusic className="h-10 w-10 text-[var(--salt-mist)] opacity-35" aria-hidden />
            <p className="mt-3 text-[13px] font-semibold text-[var(--salt-white)]">Your queue is empty</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--salt-mist)]">
              Add a track to see playback order here.
            </p>
          </div>
        ) : (
          <VirtualList
            items={queue}
            estimateSize={72}
            label="Desktop playback queue"
            getItemKey={(item, index) => `${item.song.id}-${index}`}
            className="h-full px-2 py-2"
            style={{ height: '100%' }}
            renderItem={(item, index) => {
              const active = index === queueIndex;
              return (
                <div
                  className={`group flex items-center gap-1.5 rounded-lg px-1.5 py-2 transition-colors ${active ? 'bg-[var(--salt-ghost)]' : 'hover:bg-[var(--glass-bg-hover)]'}`}
                >
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    type="button"
                    onClick={() => playQueueIndex(index)}
                    aria-label={`${active ? 'Playing' : 'Play'} ${item.song.title} by ${item.song.artist}`}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
                  >
                    <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-[var(--salt-ghost)]">
                      <CoverArt
                        src={item.song.coverArt}
                        alt=""
                        loading="lazy"
                        sizes="40px"
                        className="h-full w-full object-cover"
                      />
                      {active && (
                        <span className="absolute inset-0 flex items-center justify-center bg-[rgba(13,111,168,0.72)] text-white">
                          <Play className="h-3.5 w-3.5" aria-hidden />
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-[12px] font-semibold ${active ? 'text-[var(--salt-primary)]' : 'text-[var(--salt-white)]'}`}
                      >
                        {item.song.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-[var(--salt-mist)]">
                        {item.song.artist}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.04em] text-[var(--salt-mist)]">
                        <span>{item.song.provider}</span>
                        {item.addedBy === 'autoplay' && <span className="text-[var(--salt-primary)]">Autoplay</span>}
                      </span>
                    </span>
                    <span className="shrink-0 self-start pt-0.5 text-[10px] tabular-nums text-[var(--salt-mist)]">
                      {formatDuration(item.song.duration)}
                    </span>
                  </motion.button>
                  <div className="flex shrink-0 flex-col opacity-50 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      type="button"
                      onClick={() => reorderQueue(index, index - 1)}
                      disabled={index === 0}
                      aria-label={`Move ${item.song.title} earlier`}
                      title="Move earlier"
                      className="flex h-6 w-6 items-center justify-center rounded text-[var(--salt-mist)] hover:bg-white hover:text-[var(--salt-primary)] disabled:opacity-25"
                    >
                      <ChevronUp className="h-3 w-3" aria-hidden />
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      type="button"
                      onClick={() => reorderQueue(index, index + 1)}
                      disabled={index === queue.length - 1}
                      aria-label={`Move ${item.song.title} later`}
                      title="Move later"
                      className="flex h-6 w-6 items-center justify-center rounded text-[var(--salt-mist)] hover:bg-white hover:text-[var(--salt-primary)] disabled:opacity-25"
                    >
                      <ChevronDown className="h-3 w-3" aria-hidden />
                    </motion.button>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    type="button"
                    onClick={() => removeFromQueue(index)}
                    aria-label={`Remove ${item.song.title} from queue`}
                    title="Remove from queue"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--salt-mist)] opacity-50 transition-opacity hover:bg-white hover:text-[var(--danger)] group-hover:opacity-100 group-focus-within:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </motion.button>
                </div>
              );
            }}
          />
        )}
      </div>

      <footer className="marea-glass-surface flex shrink-0 items-center gap-1.5 border-t px-3 py-3">
        <motion.button
          whileTap={{ scale: 0.96 }}
          type="button"
          onClick={toggleAutoplay}
          disabled={queue.length === 0}
          aria-pressed={autoplay}
          className={`inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${autoplay ? 'bg-[var(--salt-ghost)] text-[var(--salt-primary)]' : 'border border-[var(--glass-border)] text-[var(--salt-mist)] hover:bg-[var(--glass-bg-hover)]'}`}
        >
          <Sparkles className="h-3 w-3" aria-hidden />
          Autoplay
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.96 }}
          type="button"
          onClick={clearQueue}
          disabled={queue.length === 0}
          aria-label="Clear queue"
          title="Clear queue"
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.96 }}
          type="button"
          onClick={() => onModeChange('hidden')}
          aria-label="Hide queue"
          title="Hide queue"
          className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-primary)]"
        >
          <EyeOff className="h-3.5 w-3.5" aria-hidden />
        </motion.button>
      </footer>
    </aside>
  );
}
