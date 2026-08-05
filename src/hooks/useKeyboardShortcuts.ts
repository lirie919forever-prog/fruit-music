'use client';

import { useEffect, useRef } from 'react';
import { usePlayerStoreApi } from '@/store/playerStore';

function acceptsGlobalShortcut(target: EventTarget | null, allowControlTarget = false): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (target.isContentEditable) return false;
  if (allowControlTarget) return !target.closest('input, select, textarea, [contenteditable="true"], [role="textbox"]');
  return !target.closest('button, a, input, select, textarea, [role="button"], [role="slider"]');
}

export interface KeyboardShortcutActions {
  seek: (time: number) => void;
  importLocalAudio?: () => void;
  toggleLyrics?: () => void;
  toggleQueue?: () => void;
  openSettings?: () => void;
  toggleFullscreenLyrics?: () => void;
  toggleTheme?: () => void;
}

export function useKeyboardShortcuts(actions: KeyboardShortcutActions) {
  const playerStore = usePlayerStoreApi();
  const actionsRef = useRef(actions);

  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.altKey) return;

      const hasCommandModifier = event.ctrlKey || event.metaKey;
      if (!acceptsGlobalShortcut(event.target, hasCommandModifier)) return;

      const state = playerStore.getState();
      const key = event.key.toLowerCase();

      if (hasCommandModifier) {
        if (key === 'o') {
          event.preventDefault();
          actionsRef.current.importLocalAudio?.();
        } else if (key === 'l') {
          event.preventDefault();
          actionsRef.current.toggleLyrics?.();
        } else if (key === 'q') {
          event.preventDefault();
          actionsRef.current.toggleQueue?.();
        } else if (event.key === ',') {
          event.preventDefault();
          actionsRef.current.openSettings?.();
        }
        return;
      }

      if (event.key === ' ') {
        event.preventDefault();
        state.togglePlay();
      } else if (event.key === 'ArrowRight' && state.duration > 0) {
        event.preventDefault();
        actionsRef.current.seek(Math.min(state.duration, state.progress + 5));
      } else if (event.key === 'ArrowLeft' && state.duration > 0) {
        event.preventDefault();
        actionsRef.current.seek(Math.max(0, state.progress - 5));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        state.setVolume(Math.min(1, state.volume + 0.05));
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        state.setVolume(Math.max(0, state.volume - 0.05));
      } else if (key === 'm') {
        event.preventDefault();
        state.toggleMute();
      } else if (key === 'f') {
        event.preventDefault();
        actionsRef.current.toggleFullscreenLyrics?.();
      } else if (key === 't') {
        event.preventDefault();
        actionsRef.current.toggleTheme?.();
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
  }, [playerStore]);
}
