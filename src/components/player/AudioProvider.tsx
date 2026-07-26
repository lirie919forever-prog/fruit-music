'use client';

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { Howl } from 'howler';
import { usePlayerStore, usePlayerStoreApi } from '@/store/playerStore';
import { api } from '@/lib/api';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import {
  effectiveDuration,
  getResumePosition,
  hasNextInQueue,
  isNaturalTrackEnd,
} from '@/components/player/playbackRecovery';
import type { Song } from '@/types/music';

interface AudioContextType {
  seek: (time: number) => void;
  stop: () => void;
  getHowl: () => Howl | null;
}

const AudioCtx = createContext<AudioContextType | null>(null);
const MAX_RETRIES = 2;
const MAX_PREMATURE_END_RECOVERIES = 2;
const UNLOCK_TIMEOUT_MS = 4_000;
const LOAD_TIMEOUT_MS = 15_000;
// Gives the mini-player a moment to show the failure reason before the queue
// moves on, so a skip doesn't read as the track silently vanishing.
const AUTO_SKIP_DELAY_MS = 1_500;

export function getHowlerFormat(song: Pick<Song, 'contentType' | 'suffix'>): string {
  const suffix = song.suffix.trim().toLowerCase().replace(/^\./, '');
  if (suffix === 'mp3' || song.contentType === 'audio/mpeg') return 'mp3';
  if (suffix === 'm4a' || song.contentType === 'audio/x-m4a') return 'm4a';
  if (suffix === 'aac' || song.contentType === 'audio/aac') return 'aac';
  if (suffix === 'ogg' || suffix === 'oga' || song.contentType === 'audio/ogg') return 'ogg';
  if (suffix === 'wav' || song.contentType === 'audio/wav') return 'wav';
  if (suffix === 'flac' || song.contentType === 'audio/flac') return 'flac';
  return suffix || 'mp3';
}

export function AudioProvider({ children }: { children: ReactNode }) {
  const playerStore = usePlayerStoreApi();
  const howlRef = useRef<Howl | null>(null);
  const pendingHowlRef = useRef<Howl | null>(null);
  const rafRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadIdRef = useRef(0);
  const retryCountRef = useRef(0);
  const streamRequestIdRef = useRef(0);
  const attemptLoadRef = useRef<(() => void) | null>(null);
  const unlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unlockHowlRef = useRef<Howl | null>(null);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSkipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentSong = usePlayerStore((state) => state.currentSong);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const playbackIntent = usePlayerStore((state) => state.playbackIntent);
  const volume = usePlayerStore((state) => state.volume);
  const next = usePlayerStore((state) => state.next);
  const previous = usePlayerStore((state) => state.previous);
  const setEnginePlaying = usePlayerStore((state) => state.setEnginePlaying);
  const setPlaybackIntent = usePlayerStore((state) => state.setPlaybackIntent);
  const setProgress = usePlayerStore((state) => state.setProgress);
  const setDuration = usePlayerStore((state) => state.setDuration);
  const setStatus = usePlayerStore((state) => state.setStatus);
  const transportCommand = usePlayerStore((state) => state.transportCommand);

  const clearRetry = useCallback(() => {
    if (!retryTimerRef.current) return;
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  const stopProgress = useCallback(() => {
    if (!rafRef.current) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  const unloadHowl = useCallback((howl?: Howl | null) => {
    if (!howl) return;
    howl.unload();
    if (howlRef.current === howl) howlRef.current = null;
    if (pendingHowlRef.current === howl) pendingHowlRef.current = null;
  }, []);

  const updateProgress = useCallback(
    function updateProgress() {
      const active = howlRef.current;
      if (!active?.playing()) {
        rafRef.current = 0;
        return;
      }

      const position = active.seek();
      if (typeof position === 'number' && Number.isFinite(position)) setProgress(position);
      rafRef.current = requestAnimationFrame(updateProgress);
    },
    [setProgress],
  );

  const startProgress = useCallback(() => {
    if (!rafRef.current) updateProgress();
  }, [updateProgress]);

  const clearUnlockWait = useCallback(() => {
    if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
    unlockTimerRef.current = null;
    unlockHowlRef.current = null;
  }, []);

  const clearLoadWait = useCallback(() => {
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    loadTimerRef.current = null;
  }, []);

  const clearAutoSkip = useCallback(() => {
    if (autoSkipTimerRef.current) clearTimeout(autoSkipTimerRef.current);
    autoSkipTimerRef.current = null;
  }, []);

  const stopEngine = useCallback(() => {
    loadIdRef.current += 1;
    attemptLoadRef.current = null;
    clearRetry();
    clearUnlockWait();
    clearLoadWait();
    clearAutoSkip();
    stopProgress();
    unloadHowl(pendingHowlRef.current);
    unloadHowl(howlRef.current);
  }, [clearAutoSkip, clearLoadWait, clearRetry, clearUnlockWait, stopProgress, unloadHowl]);

  useEffect(() => {
    stopEngine();
    setProgress(0);
    setDuration(0);

    if (!currentSong) {
      setStatus('idle');
      return;
    }

    const song = currentSong;
    const loadToken = loadIdRef.current;
    clearUnlockWait();
    retryCountRef.current = 0;
    let prematureEndRecoveries = 0;
    const shouldPlay = playerStore.getState().playbackIntent;
    setStatus(shouldPlay ? 'loading' : 'paused');

    const isCurrent = () => loadIdRef.current === loadToken && playerStore.getState().currentSong?.id === song.id;

    // A track that keeps failing after every retry should not stall a queue
    // that has somewhere else to go — Apple Music's queue moves past a dead
    // track rather than parking on it. The delay gives the mini-player's error
    // text (wired in NowPlayingBar) a moment to be seen before the skip.
    const scheduleAutoSkip = () => {
      clearAutoSkip();
      if (!hasNextInQueue(playerStore.getState())) return;
      autoSkipTimerRef.current = setTimeout(() => {
        autoSkipTimerRef.current = null;
        // `status === 'error'` is itself the "still failed, untouched by the
        // user" signal: setStatus always clears playbackIntent on entering
        // error, and togglePlay/retry always move status off 'error' first.
        const latest = playerStore.getState();
        if (!isCurrent() || latest.status !== 'error') return;
        latest.next();
      }, AUTO_SKIP_DELAY_MS);
    };

    const fail = (message: string, failedHowl?: Howl) => {
      if (failedHowl && failedHowl !== pendingHowlRef.current && failedHowl !== howlRef.current) return;
      clearLoadWait();
      const shouldRetry = isCurrent() && playerStore.getState().playbackIntent;
      if (failedHowl) unloadHowl(failedHowl);
      if (!shouldRetry) return;

      retryCountRef.current += 1;
      if (retryCountRef.current <= MAX_RETRIES) {
        clearRetry();
        retryTimerRef.current = setTimeout(() => attemptLoad(), 300 * retryCountRef.current);
        return;
      }

      setStatus('error', message);
      scheduleAutoSkip();
    };

    function attemptLoad() {
      const state = playerStore.getState();
      if (!isCurrent() || !state.playbackIntent || pendingHowlRef.current || howlRef.current) return;
      const requestId = ++streamRequestIdRef.current;
      setStatus('loading');

      api
        .getStreamUrl(song)
        .then((streamUrl) => {
          if (
            requestId !== streamRequestIdRef.current ||
            !isCurrent() ||
            !playerStore.getState().playbackIntent ||
            pendingHowlRef.current ||
            howlRef.current
          ) {
            return;
          }
          if (!streamUrl) {
            fail('No verified audio stream is available for this track.');
            return;
          }

          const howl = new Howl({
            src: [streamUrl],
            format: [getHowlerFormat(song)],
            html5: true,
            volume: playerStore.getState().volume,
            onloaderror: () => {
              clearLoadWait();
              fail('The audio stream could not be loaded. Try again.', howl);
            },
            onplayerror: () => {
              if (!isCurrent() || !playerStore.getState().playbackIntent) return;
              clearUnlockWait();
              unlockHowlRef.current = howl;
              const retryAfterUnlock = () => {
                if (unlockHowlRef.current !== howl) return;
                clearUnlockWait();
                if (isCurrent() && playerStore.getState().playbackIntent) howl.play();
              };
              howl.once('unlock', retryAfterUnlock);
              unlockTimerRef.current = setTimeout(() => {
                if (unlockHowlRef.current !== howl) return;
                clearUnlockWait();
                if (isCurrent() && playerStore.getState().playbackIntent) {
                  unloadHowl(howl);
                  setStatus('error', 'The browser blocked audio playback. Press Play to try again.');
                }
              }, UNLOCK_TIMEOUT_MS);
            },
            onload: () => {
              clearLoadWait();
              if (!isCurrent() || pendingHowlRef.current !== howl || requestId !== streamRequestIdRef.current) {
                unloadHowl(howl);
                return;
              }

              pendingHowlRef.current = null;
              howlRef.current = howl;
              const loadedDuration = howl.duration();
              // Some browsers cannot expose duration while the first response is
              // a valid 206 range. Catalog metadata is verified and is a safe
              // fallback until the media element learns the total duration.
              const resolvedDuration = effectiveDuration(loadedDuration, song.duration);
              if (resolvedDuration <= 0) {
                fail('The provider returned audio without a valid duration.', howl);
                return;
              }

              setDuration(resolvedDuration);
              setStatus('ready');
              if (playerStore.getState().playbackIntent) {
                if (prematureEndRecoveries > 0)
                  howl.seek(getResumePosition(playerStore.getState().progress, loadedDuration));
                howl.play();
              }
            },
            onplay: () => {
              if (!isCurrent() || howlRef.current !== howl) return;
              if (!playerStore.getState().playbackIntent) {
                howl.pause();
                return;
              }
              setEnginePlaying(song.id, true);
              startProgress();
            },
            onpause: () => {
              if (!isCurrent() || howlRef.current !== howl) return;
              stopProgress();
              setEnginePlaying(song.id, false);
              setPlaybackIntent(false);
            },
            onstop: () => {
              if (!isCurrent() || howlRef.current !== howl) return;
              stopProgress();
              setEnginePlaying(song.id, false);
              setPlaybackIntent(false);
            },
            onend: () => {
              if (!isCurrent() || howlRef.current !== howl) return;
              stopProgress();
              const state = playerStore.getState();
              const position = howl.seek();
              const decodedDuration = howl.duration();
              if (
                state.playbackIntent &&
                !isNaturalTrackEnd(typeof position === 'number' ? position : 0, decodedDuration, song.duration)
              ) {
                prematureEndRecoveries += 1;
                const resumePosition = typeof position === 'number' ? position : state.progress;
                unloadHowl(howl);
                if (prematureEndRecoveries <= MAX_PREMATURE_END_RECOVERIES) {
                  setProgress(resumePosition);
                  setStatus('loading');
                  retryCountRef.current = 0;
                  attemptLoadRef.current?.();
                } else {
                  setStatus('error', 'The audio stream ended before the track finished. Try again.');
                  scheduleAutoSkip();
                }
                return;
              }
              if (state.repeat === 'one' && state.playbackIntent) {
                howl.seek(0);
                setProgress(0);
                howl.play();
              } else {
                state.next();
              }
            },
          });

          pendingHowlRef.current = howl;
          clearLoadWait();
          loadTimerRef.current = setTimeout(() => {
            loadTimerRef.current = null;
            if (!isCurrent() || pendingHowlRef.current !== howl || !playerStore.getState().playbackIntent) {
              return;
            }
            setStatus('error', 'The audio stream took too long to load. Press Play to try again.');
            scheduleAutoSkip();
            unloadHowl(howl);
            clearLoadWait();
          }, LOAD_TIMEOUT_MS);
        })
        .catch(() => {
          if (requestId === streamRequestIdRef.current && isCurrent()) {
            fail('The audio stream could not be resolved. Try again.');
          }
        });
    }

    attemptLoadRef.current = attemptLoad;
    attemptLoad();

    return () => {
      loadIdRef.current += 1;
      attemptLoadRef.current = null;
      clearRetry();
      clearUnlockWait();
      clearLoadWait();
      clearAutoSkip();
      stopProgress();
      unloadHowl(pendingHowlRef.current);
      unloadHowl(howlRef.current);
    };
  }, [
    clearAutoSkip,
    clearLoadWait,
    clearRetry,
    clearUnlockWait,
    currentSong,
    playerStore,
    setDuration,
    setEnginePlaying,
    setPlaybackIntent,
    setProgress,
    setStatus,
    startProgress,
    stopEngine,
    stopProgress,
    unloadHowl,
  ]);

  useEffect(() => {
    const active = howlRef.current;
    if (playbackIntent) {
      if (active && !active.playing()) active.play();
      else if (!active && !pendingHowlRef.current) {
        retryCountRef.current = 0;
        attemptLoadRef.current?.();
      }
    } else {
      clearRetry();
      clearUnlockWait();
      clearLoadWait();
      // A pending auto-skip is deliberately NOT cancelled here: entering the
      // error state always clears playbackIntent, so cancelling would kill the
      // skip that the failure just scheduled. The timer re-checks `status`
      // before firing, which is what actually detects user intervention.
      streamRequestIdRef.current += 1;
      retryCountRef.current = 0;
      unloadHowl(pendingHowlRef.current);
      if (active?.playing()) active.pause();
      stopProgress();
    }
  }, [clearLoadWait, clearRetry, clearUnlockWait, playbackIntent, playerStore, stopProgress, unloadHowl]);

  useEffect(() => {
    howlRef.current?.volume(volume);
    pendingHowlRef.current?.volume(volume);
  }, [volume]);

  const seek = useCallback(
    (time: number) => {
      const active = howlRef.current;
      if (!active || !Number.isFinite(time)) return;
      // Same source of truth as the progress bar: bounding by the decoded
      // duration alone meant that on any track whose length only the catalog
      // knew, the scrubber rendered at full width and dragging it did nothing.
      const bound = effectiveDuration(active.duration(), playerStore.getState().currentSong?.duration ?? 0);
      if (bound <= 0) return;
      const position = Math.max(0, Math.min(bound, time));
      active.seek(position);
      setProgress(position);
    },
    [playerStore, setProgress],
  );

  useEffect(() => {
    if (transportCommand?.type === 'seek') seek(transportCommand.position);
  }, [seek, transportCommand]);

  useKeyboardShortcuts(seek);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = currentSong
      ? new MediaMetadata({
          title: currentSong.title,
          artist: currentSong.artist,
          album: currentSong.album,
          artwork: [{ src: currentSong.coverArt, sizes: '512x512' }],
        })
      : null;
    navigator.mediaSession.playbackState = !currentSong ? 'none' : isPlaying ? 'playing' : 'paused';

    const registerAction = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Browsers may expose Media Session while omitting individual actions.
      }
    };

    registerAction('play', currentSong ? () => setPlaybackIntent(true) : null);
    registerAction('pause', currentSong ? () => setPlaybackIntent(false) : null);
    registerAction('nexttrack', currentSong ? next : null);
    registerAction('previoustrack', currentSong ? previous : null);
    registerAction(
      'seekto',
      currentSong
        ? (details) => {
            if (details.seekTime !== undefined) seek(details.seekTime);
          }
        : null,
    );

    return () => {
      for (const action of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto'] as MediaSessionAction[]) {
        registerAction(action, null);
      }
    };
  }, [currentSong, isPlaying, next, previous, seek, setPlaybackIntent]);

  const stop = useCallback(() => {
    stopEngine();
    setPlaybackIntent(false);
    setStatus(currentSong ? 'paused' : 'idle');
  }, [currentSong, setPlaybackIntent, setStatus, stopEngine]);

  useEffect(() => stopEngine, [stopEngine]);

  const getHowl = useCallback(() => howlRef.current, []);

  return <AudioCtx value={{ seek, stop, getHowl }}>{children}</AudioCtx>;
}

export function useAudio() {
  const context = useContext(AudioCtx);
  if (!context) throw new Error('useAudio must be inside AudioProvider');
  return context;
}
