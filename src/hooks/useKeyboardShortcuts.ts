'use client';

import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/playerStore';

function acceptsGlobalShortcut(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (target.isContentEditable) return false;
  return !target.closest('button, a, input, select, textarea, [role="button"], [role="slider"]');
}

export function useKeyboardShortcuts(seek: (time: number) => void) {
  const seekRef = useRef(seek);

  useEffect(() => {
    seekRef.current = seek;
  }, [seek]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || !acceptsGlobalShortcut(event.target)) return;

      const state = usePlayerStore.getState();
      const key = event.key.toLowerCase();

      if (event.key === ' ') {
        event.preventDefault();
        state.togglePlay();
      } else if (event.key === 'ArrowRight' && state.duration > 0) {
        event.preventDefault();
        seekRef.current(Math.min(state.duration, state.progress + 10));
      } else if (event.key === 'ArrowLeft' && state.duration > 0) {
        event.preventDefault();
        seekRef.current(Math.max(0, state.progress - 10));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        state.setVolume(Math.min(1, state.volume + 0.1));
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        state.setVolume(Math.max(0, state.volume - 0.1));
      } else if (key === 'n') {
        event.preventDefault();
        state.next();
      } else if (key === 'p') {
        event.preventDefault();
        state.previous();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
