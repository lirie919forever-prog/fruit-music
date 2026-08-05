'use client';

import { Moon } from 'lucide-react';
import { useCallback, useSyncExternalStore } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { motion } from 'motion/react';

const PRESET_MINUTES = [15, 30, 60] as const;
/** Half a minute, so a displayed figure is never more than that out of date. */
const TICK_MS = 30_000;

/**
 * The wall clock, as something React can subscribe to.
 *
 * Reading `Date.now()` while rendering is an impure read — the same render
 * would produce a different answer each time it ran. `useSyncExternalStore` is
 * the sanctioned way to read a source that changes on its own: the interval
 * says *when* to look, and the snapshot below is what gets looked at.
 */
function subscribeToClock(onChange: () => void): () => void {
  const tick = setInterval(onChange, TICK_MS);
  return () => clearInterval(tick);
}

/** Whole minutes still to run, rounded up so "1 min" never means "already over". */
export function minutesRemaining(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / 60_000));
}

/**
 * Stop playing after a while.
 *
 * The countdown is recomputed from the store's deadline once a minute rather
 * than held in state and decremented: a decrementing counter drifts every time
 * the tab is backgrounded and its timers are throttled, and this one is read by
 * somebody falling asleep, who will not be watching it tick.
 */
export function SleepTimer() {
  const sleepTimerEndsAt = usePlayerStore((state) => state.sleepTimerEndsAt);
  const setSleepTimer = usePlayerStore((state) => state.setSleepTimer);
  // A whole number of minutes, so the snapshot is stable between ticks even
  // though the clock behind it is not. Copying the figure into state instead
  // would mean keeping two sources in step from an effect, and the first paint
  // would show a stale one.
  const remaining = useSyncExternalStore(
    subscribeToClock,
    useCallback(
      () => (sleepTimerEndsAt === null ? null : minutesRemaining(sleepTimerEndsAt, Date.now())),
      [sleepTimerEndsAt],
    ),
    // On the server there is no timer yet, because nothing has set one.
    () => null,
  );

  const active = sleepTimerEndsAt !== null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--salt-mist)]">
        <Moon aria-hidden className="h-3.5 w-3.5" />
        Sleep
      </span>
      {PRESET_MINUTES.map((minutes) => (
        <motion.button
          whileTap={{ scale: 0.96 }}
          key={minutes}
          type="button"
          onClick={() => setSleepTimer(minutes)}
          className="rounded-full border border-[var(--glass-border)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
        >
          {minutes} min
        </motion.button>
      ))}
      {active && (
        <motion.button
          whileTap={{ scale: 0.96 }}
          type="button"
          onClick={() => setSleepTimer(null)}
          className="rounded-full bg-[var(--salt-ghost)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--salt-primary)] transition-colors hover:bg-[var(--glass-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
        >
          Cancel
        </motion.button>
      )}
      {/* Announced politely rather than as an alert: it changes once a minute
          and is a status, not something the reader has to act on. */}
      <span role="status" aria-live="polite" className="text-[11px] text-[var(--salt-mist)]">
        {remaining === null ? '' : `Stopping in ${remaining} min`}
      </span>
    </div>
  );
}
