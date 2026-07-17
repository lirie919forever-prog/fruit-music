'use client';

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { Howl } from 'howler';
import { usePlayerStore } from '@/store/playerStore';
import { api } from '@/lib/api';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import type { Song } from '@/types/music';

interface AudioContextType {
  seek: (time: number) => void;
  stop: () => void;
  getHowl: () => Howl | null;
}

const AudioCtx = createContext<AudioContextType | null>(null);
const MAX_RETRIES = 2;

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
  const howlRef = useRef<Howl | null>(null);
  const pendingHowlRef = useRef<Howl | null>(null);
  const rafRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadIdRef = useRef(0);
  const retryCountRef = useRef(0);
  const attemptLoadRef = useRef<(() => void) | null>(null);

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

  const updateProgress = useCallback(function updateProgress() {
    const active = howlRef.current;
    if (!active?.playing()) {
      rafRef.current = 0;
      return;
    }

    const position = active.seek();
    if (typeof position === 'number' && Number.isFinite(position)) setProgress(position);
    rafRef.current = requestAnimationFrame(updateProgress);
  }, [setProgress]);

  const startProgress = useCallback(() => {
    if (!rafRef.current) updateProgress();
  }, [updateProgress]);

  const stopEngine = useCallback(() => {
    loadIdRef.current += 1;
    attemptLoadRef.current = null;
    clearRetry();
    stopProgress();
    unloadHowl(pendingHowlRef.current);
    unloadHowl(howlRef.current);
  }, [clearRetry, stopProgress, unloadHowl]);

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
    retryCountRef.current = 0;
    const shouldPlay = usePlayerStore.getState().playbackIntent;
    setStatus(shouldPlay ? 'loading' : 'paused');

    const isCurrent = () => loadIdRef.current === loadToken
      && usePlayerStore.getState().currentSong?.id === song.id;

    const fail = (message: string, failedHowl?: Howl) => {
      if (failedHowl) unloadHowl(failedHowl);
      if (!isCurrent()) return;

      retryCountRef.current += 1;
      if (retryCountRef.current <= MAX_RETRIES) {
        clearRetry();
        retryTimerRef.current = setTimeout(() => attemptLoad(), 300 * retryCountRef.current);
        return;
      }

      setStatus('error', message);
    };

    function attemptLoad() {
      const state = usePlayerStore.getState();
      if (!isCurrent() || !state.playbackIntent || pendingHowlRef.current || howlRef.current) return;
      setStatus('loading');

      api.getStreamUrl(song).then((streamUrl) => {
        if (!isCurrent() || !usePlayerStore.getState().playbackIntent) return;
        if (!streamUrl) {
          fail('No verified audio stream is available for this track.');
          return;
        }

        const howl = new Howl({
          src: [streamUrl],
          format: [getHowlerFormat(song)],
          html5: true,
          volume: usePlayerStore.getState().volume,
          onloaderror: () => fail('The audio stream could not be loaded. Try again.', howl),
          onplayerror: () => fail('Playback was blocked or the audio stream failed. Try again.', howl),
          onload: () => {
            if (!isCurrent()) {
              unloadHowl(howl);
              return;
            }

            pendingHowlRef.current = null;
            howlRef.current = howl;
            const loadedDuration = howl.duration();
            if (!Number.isFinite(loadedDuration) || loadedDuration <= 0) {
              fail('The provider returned audio without a valid duration.', howl);
              return;
            }

            setDuration(loadedDuration);
            setStatus('ready');
            if (usePlayerStore.getState().playbackIntent) howl.play();
          },
          onplay: () => {
            if (!isCurrent() || howlRef.current !== howl) return;
            if (!usePlayerStore.getState().playbackIntent) {
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
            const state = usePlayerStore.getState();
            if (state.repeat === 'one' && state.playbackIntent) {
              howl.seek(0);
              howl.play();
            } else {
              state.next();
            }
          },
        });

        pendingHowlRef.current = howl;
      }).catch(() => {
        if (isCurrent()) fail('The audio stream could not be resolved. Try again.');
      });
    }

    attemptLoadRef.current = attemptLoad;
    attemptLoad();

    return () => {
      loadIdRef.current += 1;
      attemptLoadRef.current = null;
      clearRetry();
      stopProgress();
      unloadHowl(pendingHowlRef.current);
      unloadHowl(howlRef.current);
    };
  }, [clearRetry, currentSong, setDuration, setEnginePlaying, setPlaybackIntent, setProgress, setStatus, startProgress, stopEngine, stopProgress, unloadHowl]);

  useEffect(() => {
    const active = howlRef.current;
    if (playbackIntent) {
      if (active && !active.playing()) active.play();
      else if (!active && !pendingHowlRef.current) {
        if (usePlayerStore.getState().status === 'loading') retryCountRef.current = 0;
        attemptLoadRef.current?.();
      }
    } else {
      clearRetry();
      if (active?.playing()) active.pause();
      stopProgress();
    }
  }, [clearRetry, playbackIntent, stopProgress]);

  useEffect(() => {
    howlRef.current?.volume(volume);
    pendingHowlRef.current?.volume(volume);
  }, [volume]);

  const seek = useCallback((time: number) => {
    const active = howlRef.current;
    if (!active || !Number.isFinite(time)) return;
    const activeDuration = active.duration();
    if (!Number.isFinite(activeDuration) || activeDuration <= 0) return;
    const position = Math.max(0, Math.min(activeDuration, time));
    active.seek(position);
    setProgress(position);
  }, [setProgress]);

  useEffect(() => {
    if (transportCommand?.type === 'seek') seek(transportCommand.position);
  }, [seek, transportCommand]);

  useKeyboardShortcuts(seek);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = currentSong ? new MediaMetadata({
      title: currentSong.title,
      artist: currentSong.artist,
      album: currentSong.album,
      artwork: [{ src: currentSong.coverArt, sizes: '512x512' }],
    }) : null;
    navigator.mediaSession.playbackState = !currentSong ? 'none' : isPlaying ? 'playing' : 'paused';

    navigator.mediaSession.setActionHandler('play', currentSong ? () => setPlaybackIntent(true) : null);
    navigator.mediaSession.setActionHandler('pause', currentSong ? () => setPlaybackIntent(false) : null);
    navigator.mediaSession.setActionHandler('nexttrack', currentSong ? next : null);
    navigator.mediaSession.setActionHandler('previoustrack', currentSong ? previous : null);
    navigator.mediaSession.setActionHandler('seekto', currentSong ? (details) => {
      if (details.seekTime !== undefined) seek(details.seekTime);
    } : null);

    return () => {
      for (const action of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto'] as MediaSessionAction[]) {
        navigator.mediaSession.setActionHandler(action, null);
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
