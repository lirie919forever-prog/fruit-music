'use client';

import { ChevronDown, ChevronUp, MoreHorizontal, ListMusic, Play, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { CoverArt } from '@/components/ui/CoverArt';
import { VirtualList } from '@/components/ui/VirtualList';
import { lockBodyScroll } from '@/lib/scrollLock';
import { usePlayerStore } from '@/store/playerStore';
import { motion } from 'motion/react';

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function focusableElements(container: HTMLElement | null): HTMLElement[] {
  return Array.from(
    container?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [],
  ).filter((element) => element.offsetParent !== null);
}

export function QueueDrawer({
  open,
  onClose,
  onOpenFullPlayer,
}: {
  open: boolean;
  onClose: () => void;
  onOpenFullPlayer: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const queue = usePlayerStore((state) => state.queue);
  const queueIndex = usePlayerStore((state) => state.queueIndex);
  const removeFromQueue = usePlayerStore((state) => state.removeFromQueue);
  const reorderQueue = usePlayerStore((state) => state.reorderQueue);
  const playQueueIndex = usePlayerStore((state) => state.playQueueIndex);
  const clearQueue = usePlayerStore((state) => state.clearQueue);
  const autoplay = usePlayerStore((state) => state.autoplay);
  const toggleAutoplay = usePlayerStore((state) => state.toggleAutoplay);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseScroll = lockBodyScroll();
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = focusableElements(dialogRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      releaseScroll();
      document.removeEventListener('keydown', handleKeyDown);
      requestAnimationFrame(() => returnFocusRef.current?.focus());
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]" role="presentation">
      <motion.button
        whileTap={{ scale: 0.96 }}
        type="button"
        aria-label="Close queue"
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(13,43,62,0.28)] backdrop-blur-[2px]"
      />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="queue-drawer-title"
        className="marea-glass-panel absolute inset-y-0 right-0 flex w-full max-w-[440px] flex-col border-l"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--glass-border)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--salt-ghost)] text-[var(--salt-primary)]">
              <ListMusic className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 id="queue-drawer-title" className="truncate text-[17px] font-bold text-[var(--salt-white)]">
                Up next
              </h2>
              <p className="mt-0.5 text-xs text-[var(--salt-mist)]">
                {queue.length} {queue.length === 1 ? 'track' : 'tracks'} in this queue
              </p>
            </div>
          </div>
          <motion.button
            whileTap={{ scale: 0.96 }}
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close queue"
            title="Close queue"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-white)]"
          >
            <X className="h-5 w-5" aria-hidden />
          </motion.button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {queue.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
              <ListMusic className="h-12 w-12 text-[var(--salt-mist)] opacity-35" aria-hidden />
              <h3 className="mt-4 text-[15px] font-bold text-[var(--salt-white)]">Your queue is empty</h3>
              <p className="mt-1 max-w-xs text-[13px] leading-relaxed text-[var(--salt-mist)]">
                Add tracks from any source and they will appear here in playback order.
              </p>
            </div>
          ) : (
            <VirtualList
              items={queue}
              estimateSize={68}
              label="Playback queue"
              getItemKey={(item, index) => `${item.song.id}-${index}`}
              className="min-h-0 flex-1 px-3 py-3"
              style={{ height: '100%' }}
              renderItem={(item, index) => {
                const active = index === queueIndex;
                const canMoveUp = index > 0;
                const canMoveDown = index < queue.length - 1;
                return (
                  <div
                    className={`group flex items-center gap-2 rounded-xl px-2 py-2 transition-colors ${active ? 'bg-[var(--salt-ghost)]' : 'hover:bg-[var(--glass-bg-hover)]'}`}
                  >
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      type="button"
                      onClick={() => playQueueIndex(index)}
                      aria-label={`${active ? 'Playing' : 'Play'} ${item.song.title} by ${item.song.artist}`}
                      className="relative flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
                    >
                      <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-[var(--salt-ghost)]">
                        <CoverArt
                          src={item.song.coverArt}
                          alt=""
                          loading="lazy"
                          sizes="44px"
                          className="h-full w-full object-cover"
                        />
                        {active && (
                          <span className="absolute inset-0 flex items-center justify-center bg-[rgba(13,111,168,0.72)] text-white">
                            <Play className="h-4 w-4" aria-hidden />
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[13px] font-semibold ${active ? 'text-[var(--salt-primary)]' : 'text-[var(--salt-white)]'}`}
                        >
                          {item.song.title}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-[var(--salt-mist)]">
                          {item.song.artist}
                        </span>
                        <span className="mt-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--salt-mist)]">
                          <span>{item.song.provider}</span>
                          {item.addedBy === 'autoplay' && <span className="text-[var(--salt-primary)]">Autoplay</span>}
                        </span>
                      </span>
                      <span className="shrink-0 self-start pt-1 text-[11px] tabular-nums text-[var(--salt-mist)]">
                        {formatDuration(item.song.duration)}
                      </span>
                    </motion.button>
                    <div className="flex shrink-0 items-center opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <motion.button
                        whileTap={{ scale: 0.96 }}
                        type="button"
                        onClick={() => reorderQueue(index, index - 1)}
                        disabled={!canMoveUp}
                        aria-label={`Move ${item.song.title} earlier`}
                        title="Move earlier"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--salt-mist)] hover:bg-white hover:text-[var(--salt-primary)] disabled:cursor-not-allowed disabled:opacity-25"
                      >
                        <ChevronUp className="h-4 w-4" aria-hidden />
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.96 }}
                        type="button"
                        onClick={() => reorderQueue(index, index + 1)}
                        disabled={!canMoveDown}
                        aria-label={`Move ${item.song.title} later`}
                        title="Move later"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--salt-mist)] hover:bg-white hover:text-[var(--salt-primary)] disabled:cursor-not-allowed disabled:opacity-25"
                      >
                        <ChevronDown className="h-4 w-4" aria-hidden />
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.96 }}
                        type="button"
                        onClick={() => removeFromQueue(index)}
                        aria-label={`Remove ${item.song.title} from queue`}
                        title="Remove from queue"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--salt-mist)] hover:bg-white hover:text-[var(--danger)]"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </motion.button>
                    </div>
                  </div>
                );
              }}
            />
          )}
        </div>

        <footer className="relative z-[101] flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--glass-border)] bg-[rgba(251,252,254,0.99)] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <motion.button
            whileTap={{ scale: 0.96 }}
            type="button"
            onClick={toggleAutoplay}
            disabled={queue.length === 0}
            aria-pressed={autoplay}
            className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${autoplay ? 'bg-[var(--salt-ghost)] text-[var(--salt-primary)]' : 'border border-[var(--glass-border)] text-[var(--salt-mist)] hover:bg-[var(--glass-bg-hover)]'}`}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Autoplay {autoplay ? 'on' : 'off'}
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.96 }}
            type="button"
            onClick={clearQueue}
            disabled={queue.length === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Clear
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.96 }}
            type="button"
            onClick={onOpenFullPlayer}
            className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--glass-border)] px-3 text-xs font-semibold text-[var(--salt-primary)] transition-colors hover:bg-[var(--glass-bg-hover)]"
          >
            Open full player
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </motion.button>
        </footer>
      </aside>
    </div>
  );
}
