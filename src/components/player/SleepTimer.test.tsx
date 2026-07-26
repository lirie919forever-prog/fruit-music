/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlayerStoreProvider, usePlayerStoreApi, type PlayerStore } from '@/store/playerStore';
import { SleepTimer, minutesRemaining } from './SleepTimer';

let store: PlayerStore;

function Probe() {
  const api = usePlayerStoreApi();
  useEffect(() => {
    store = api;
  }, [api]);
  return null;
}

function mount() {
  return render(
    <PlayerStoreProvider initialView="now-playing" initialQuery="">
      <Probe />
      <SleepTimer />
    </PlayerStoreProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('minutesRemaining', () => {
  it('rounds up, so the last partial minute still reads as one', () => {
    expect(minutesRemaining(1_000_000 + 30_000, 1_000_000)).toBe(1);
    expect(minutesRemaining(1_000_000 + 1, 1_000_000)).toBe(1);
  });

  it('never reports a negative wait for a deadline already past', () => {
    expect(minutesRemaining(1_000_000, 1_500_000)).toBe(0);
  });
});

describe('SleepTimer', () => {
  beforeEach(() => {
    // One clock installed for the whole suite. Calling `useFakeTimers` again
    // inside a test, after a system time has already been mocked, is an error
    // in vitest rather than a fresh start.
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-07-27T12:00:00Z') });
  });

  function typist() {
    return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  }

  /**
   * Asserts the deadline is `minutes` out from the moment of the click.
   *
   * Bracketed rather than compared to a single `Date.now()`: the clock advances
   * while userEvent works through its own delays, so by the time the assertion
   * runs "now" is a few milliseconds past the instant the store read.
   */
  async function expectDeadline(click: () => Promise<void>, minutes: number) {
    const before = Date.now();
    await click();
    const after = Date.now();
    const endsAt = store.getState().sleepTimerEndsAt!;
    expect(endsAt).toBeGreaterThanOrEqual(before + minutes * 60_000);
    expect(endsAt).toBeLessThanOrEqual(after + minutes * 60_000);
  }

  it('shows nothing pending until a preset is chosen', () => {
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('sets a deadline the requested number of minutes out', async () => {
    const user = typist();
    mount();

    await expectDeadline(() => user.click(screen.getByRole('button', { name: '30 min' })), 30);
    expect(screen.getByRole('status')).toHaveTextContent('Stopping in 30 min');
  });

  it('counts down from the deadline rather than from its own tally', async () => {
    const user = typist();
    mount();
    await user.click(screen.getByRole('button', { name: '15 min' }));

    // Ten minutes of wall clock pass while the tab is backgrounded and its
    // interval fires once instead of twenty times. A counter that decremented
    // per tick would still say 15; reading the deadline says 5.
    await act(async () => {
      vi.setSystemTime(Date.now() + 10 * 60_000);
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(screen.getByRole('status')).toHaveTextContent('Stopping in 5 min');
  });

  it('cancels back to nothing pending', async () => {
    const user = typist();
    mount();
    await user.click(screen.getByRole('button', { name: '60 min' }));

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(store.getState().sleepTimerEndsAt).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('replaces an existing deadline rather than stacking a second one', async () => {
    const user = typist();
    mount();

    await user.click(screen.getByRole('button', { name: '60 min' }));
    await expectDeadline(() => user.click(screen.getByRole('button', { name: '15 min' })), 15);
  });
});

describe('setSleepTimer', () => {
  it('treats a nonsensical duration as cancelling, not as a deadline in the past', () => {
    const { unmount } = mount();
    act(() => store.getState().setSleepTimer(30));
    expect(store.getState().sleepTimerEndsAt).not.toBeNull();

    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      act(() => store.getState().setSleepTimer(30));
      act(() => store.getState().setSleepTimer(bad));
      expect(store.getState().sleepTimerEndsAt, `minutes=${bad}`).toBeNull();
    }
    unmount();
  });
});
