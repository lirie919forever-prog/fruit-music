'use client';

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { Howl } from 'howler';
import { usePlayerStore, usePlayerStoreApi } from '@/store/playerStore';
import type { PlaybackCandidate } from '@/lib/catalogTypes';
import {
  effectiveDuration,
  getResumePosition,
  hasNextInQueue,
  isMateriallyLongStream,
  isMateriallyShortStream,
  isNaturalTrackEnd,
} from '@/components/player/playbackRecovery';
import { DEFAULT_SEEK_OFFSET_SECONDS, mediaMetadataInit, positionState } from '@/components/player/mediaSession';
import type { Song } from '@/types/music';
import { setPlaybackClock } from './playbackClock';
import { htmlAudioEngine } from '@/lib/audio/HtmlAudioEngine';
import { useToast } from '@/components/ui/Toast';
import { isResolverSource } from '@/lib/sourceRegistry';
import { useMusicCatalog } from '@/lib/musicCatalog';

/** Every action this app registers, so the cleanup cannot fall out of step. */
const MEDIA_SESSION_ACTIONS = [
  'play',
  'pause',
  'stop',
  'nexttrack',
  'previoustrack',
  'seekbackward',
  'seekforward',
  'seekto',
] as const satisfies readonly MediaSessionAction[];

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
  const catalog = useMusicCatalog();
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
  const duration = usePlayerStore((state) => state.duration);
  const playbackIntent = usePlayerStore((state) => state.playbackIntent);
  const volume = usePlayerStore((state) => state.volume);
  const next = usePlayerStore((state) => state.next);
  const previous = usePlayerStore((state) => state.previous);
  const setEnginePlaying = usePlayerStore((state) => state.setEnginePlaying);
  const setEffectiveSong = usePlayerStore((state) => state.setEffectiveSong);
  const setPlaybackIntent = usePlayerStore((state) => state.setPlaybackIntent);
  const setProgress = usePlayerStore((state) => state.setProgress);
  const setDuration = usePlayerStore((state) => state.setDuration);
  const setStatus = usePlayerStore((state) => state.setStatus);
  const transportCommand = usePlayerStore((state) => state.transportCommand);
  const sleepTimerEndsAt = usePlayerStore((state) => state.sleepTimerEndsAt);
  const playerStatus = usePlayerStore((state) => state.status);
  const playerError = usePlayerStore((state) => state.error);
  const { push } = useToast();
  const lastToastedErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (playerStatus !== 'error' || !playerError) {
      lastToastedErrorRef.current = null;
      return;
    }
    if (lastToastedErrorRef.current === playerError) return;
    lastToastedErrorRef.current = playerError;
    push(playerError, 'error');
  }, [playerError, playerStatus, push]);

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
    htmlAudioEngine.release(howl);
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
      if (typeof position === 'number' && Number.isFinite(position)) {
        // The external clock is the only frame-rate publication. The durable
        // player store is intentionally not updated here: a progress tick must
        // never make browse lists, menus, or queue rows participate in playback.
        setPlaybackClock(position, playerStore.getState().currentSong?.id ?? null);
      }
      rafRef.current = requestAnimationFrame(updateProgress);
    },
    [playerStore],
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
    let sourceSong = song;
    const loadToken = loadIdRef.current;
    const loadController = new AbortController();
    let autoplayStarted = false;
    clearUnlockWait();
    retryCountRef.current = 0;
    let prematureEndRecoveries = 0;
    let playbackCandidates: PlaybackCandidate[] = [];
    let candidateIndex = 0;
    let alternateResolutionStarted = false;
    let recoveryFailureMessage: string | null = null;
    // A new track has not resolved yet, so any fallback identity held over from
    // the previous one must not survive — lyrics would query the wrong record.
    setEffectiveSong(null);
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

    const continueWithAutoplay = async () => {
      if (autoplayStarted || !isCurrent()) return;
      const state = playerStore.getState();
      if (!state.autoplay || !state.currentSong || state.currentSong.isLive) return;

      autoplayStarted = true;
      setStatus('loading');
      try {
        const seed = state.currentSong;
        const stationCatalog = await catalog.getGenreSongs(seed.genre.trim() || 'pop', 18, loadController.signal);
        const latest = playerStore.getState();
        if (loadController.signal.aborted || !isCurrent() || !latest.playbackIntent) {
          return;
        }
        // Autoplay is a user preference, but this request is asynchronous. A
        // toggle made while the catalog is in flight must win over the stale
        // state captured before the request started.
        if (!latest.autoplay) {
          latest.setPlaybackIntent(false);
          return;
        }

        const existing = new Set(latest.queue.map((item) => item.song.id));
        const recommendations = stationCatalog.results
          .filter(
            (candidate) =>
              !existing.has(candidate.id) && candidate.playbackUnavailable !== true && candidate.isLive !== true,
          )
          .slice(0, 8);

        if (recommendations.length === 0) {
          latest.setPlaybackIntent(false);
          return;
        }

        latest.appendToQueue(recommendations, 'autoplay');
        latest.next();
      } catch {
        const latest = playerStore.getState();
        if (loadController.signal.aborted || !isCurrent() || !latest.autoplay || !latest.playbackIntent) return;
        playerStore.getState().setStatus('error', 'Autoplay could not find another verified track.');
      }
    };

    const resolveAlternates = (message: string): boolean => {
      if (alternateResolutionStarted || !isResolverSource(sourceSong.provider)) {
        return false;
      }

      alternateResolutionStarted = true;
      clearRetry();
      setStatus('loading');
      void catalog
        .getPlaybackAlternates(sourceSong, loadController.signal)
        .then((alternates) => {
          if (loadController.signal.aborted || !isCurrent() || !playerStore.getState().playbackIntent) return;

          const hadCandidates = playbackCandidates.length > 0;
          const seen = new Set(playbackCandidates.map((candidate) => candidate.song.id));
          const freshAlternates = alternates.filter((candidate) => {
            if (seen.has(candidate.song.id)) return false;
            seen.add(candidate.song.id);
            return true;
          });
          playbackCandidates = [...playbackCandidates, ...freshAlternates];

          // A direct resolution failure leaves the candidate list empty. In
          // that case the first alternate is the current candidate, not the
          // candidate after index zero. Once a direct candidate exists, move
          // to the next one as usual.
          const nextCandidateIndex = hadCandidates ? candidateIndex + 1 : 0;
          if (nextCandidateIndex >= playbackCandidates.length) {
            setStatus('error', message);
            scheduleAutoSkip();
            return;
          }

          candidateIndex = nextCandidateIndex;
          prematureEndRecoveries = 0;
          retryCountRef.current = 0;
          setProgress(0);
          setStatus('loading');
          attemptLoadRef.current?.();
        })
        .catch(() => {
          if (loadController.signal.aborted || !isCurrent() || !playerStore.getState().playbackIntent) return;
          setStatus('error', message);
          scheduleAutoSkip();
        });

      return true;
    };

    const fail = (message: string, failedHowl?: Howl) => {
      if (failedHowl && failedHowl !== pendingHowlRef.current && failedHowl !== howlRef.current) return;
      clearLoadWait();
      const shouldRetry = isCurrent() && playerStore.getState().playbackIntent;
      if (failedHowl) unloadHowl(failedHowl);
      if (!shouldRetry) return;

      if (candidateIndex + 1 < playbackCandidates.length) {
        candidateIndex += 1;
        retryCountRef.current = 0;
        clearRetry();
        retryTimerRef.current = setTimeout(() => attemptLoad(), 150);
        return;
      }

      if (resolveAlternates(message)) return;

      retryCountRef.current += 1;
      if (retryCountRef.current <= MAX_RETRIES) {
        clearRetry();
        retryTimerRef.current = setTimeout(() => attemptLoad(), 300 * retryCountRef.current);
        return;
      }

      setStatus('error', recoveryFailureMessage ?? message);
      scheduleAutoSkip();
    };

    function attemptLoad() {
      const state = playerStore.getState();
      if (!isCurrent() || !state.playbackIntent || pendingHowlRef.current || howlRef.current) return;
      const requestId = ++streamRequestIdRef.current;
      setStatus('loading');

      const candidate = playbackCandidates[candidateIndex];
      const candidateUrl = candidate?.streamUrl;
      const sourcePromise: Promise<{ song: Song; streamUrl: string }> = candidate
        ? candidateUrl
          ? Promise.resolve({ song: candidate.song, streamUrl: candidateUrl })
          : catalog
              .getStreamUrl(candidate.song, loadController.signal)
              .then((streamUrl) => ({ song: candidate.song, streamUrl }))
        : catalog.getPlaybackSource(song, loadController.signal).then((source) => {
            playbackCandidates = source.candidates ?? [{ song: source.song, streamUrl: source.streamUrl }];
            candidateIndex = 0;
            return { song: source.song, streamUrl: source.streamUrl };
          });

      sourcePromise
        .then(({ song: resolvedSong, streamUrl }) => {
          sourceSong = resolvedSong;
          if (
            requestId !== streamRequestIdRef.current ||
            !isCurrent() ||
            !playerStore.getState().playbackIntent ||
            pendingHowlRef.current ||
            howlRef.current
          ) {
            return;
          }
          // A fallback substitution (an Apple preview swapped for a full Kuwo/LX
          // track) is the case `effectiveSong` exists for: lyrics are matched
          // against the recording that is playing, not the catalog row the user
          // picked. The store clears it to null on every new track, so it is
          // only non-null while this resolved track is the one playing.
          setEffectiveSong(resolvedSong.id === song.id ? null : resolvedSong);
          if (!streamUrl) {
            fail('No verified audio stream is available for this track.');
            return;
          }

          const howl = htmlAudioEngine.create(
            {
              src: [streamUrl],
              format: [getHowlerFormat(sourceSong)],
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

                if (!htmlAudioEngine.adopt(howl)) {
                  unloadHowl(howl);
                  return;
                }
                pendingHowlRef.current = null;
                howlRef.current = howl;
                const loadedDuration = howl.duration();
                const resolverCanReturnShortClips = isResolverSource(sourceSong.provider);
                const materiallyShort = isMateriallyShortStream(loadedDuration, sourceSong.duration);
                const materiallyLong = isMateriallyLongStream(loadedDuration, sourceSong.duration);
                if (resolverCanReturnShortClips && !sourceSong.isLive && (materiallyShort || materiallyLong)) {
                  // A successful response is not enough: Kuwo and similar
                  // resolvers can return either a short preview or a completely
                  // different long recording for a catalog item. Discard it
                  // before the mini-player exposes the wrong duration, then
                  // try the next exact-match candidate already attached to this
                  // load.
                  unloadHowl(howl);
                  setEffectiveSong(null);
                  recoveryFailureMessage = materiallyShort
                    ? 'The provider returned a short preview instead of the full track.'
                    : 'The provider returned a different recording instead of the full track.';
                  prematureEndRecoveries = 0;
                  retryCountRef.current = 0;
                  if (candidateIndex + 1 < playbackCandidates.length) {
                    candidateIndex += 1;
                    setProgress(0);
                    setStatus('loading');
                    attemptLoadRef.current?.();
                  } else if (!resolveAlternates(recoveryFailureMessage)) {
                    setStatus('error', recoveryFailureMessage);
                    scheduleAutoSkip();
                  }
                  return;
                }
                // Some browsers cannot expose duration while the first response is
                // a valid 206 range. Catalog metadata is verified and is a safe
                // fallback until the media element learns the total duration.
                const resolvedDuration = sourceSong.isLive ? 0 : effectiveDuration(loadedDuration, sourceSong.duration);
                if (!sourceSong.isLive && resolvedDuration <= 0) {
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
                if (song.isLive) {
                  if (state.playbackIntent) {
                    setStatus('error', 'The live station went offline. Try again.');
                    scheduleAutoSkip();
                  }
                  return;
                }
                const position = howl.seek();
                const decodedDuration = howl.duration();
                if (
                  state.playbackIntent &&
                  !isNaturalTrackEnd(typeof position === 'number' ? position : 0, decodedDuration, sourceSong.duration)
                ) {
                  prematureEndRecoveries += 1;
                  const resumePosition = typeof position === 'number' ? position : state.progress;
                  unloadHowl(howl);
                  if (prematureEndRecoveries <= MAX_PREMATURE_END_RECOVERIES) {
                    setProgress(resumePosition);
                    setStatus('loading');
                    retryCountRef.current = 0;
                    attemptLoadRef.current?.();
                  } else if (candidateIndex + 1 < playbackCandidates.length) {
                    candidateIndex += 1;
                    prematureEndRecoveries = 0;
                    retryCountRef.current = 0;
                    setProgress(resumePosition);
                    setStatus('loading');
                    attemptLoadRef.current?.();
                  } else if (!resolveAlternates('The audio stream ended before the track finished. Try again.')) {
                    setStatus('error', 'The audio stream ended before the track finished. Try again.');
                    scheduleAutoSkip();
                  }
                  return;
                }
                if (state.repeat === 'one' && state.playbackIntent) {
                  howl.seek(0);
                  setProgress(0);
                  howl.play();
                } else if (hasNextInQueue(state)) {
                  state.next();
                } else if (state.autoplay && !state.currentSong?.isLive) {
                  void continueWithAutoplay();
                } else {
                  state.next();
                }
              },
            },
            song.isLive === true,
          );

          pendingHowlRef.current = howl;
          clearLoadWait();
          loadTimerRef.current = setTimeout(() => {
            loadTimerRef.current = null;
            if (!isCurrent() || pendingHowlRef.current !== howl || !playerStore.getState().playbackIntent) {
              return;
            }
            fail('The audio stream took too long to load. Press Play to try again.', howl);
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
      loadController.abort();
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
    catalog,
    currentSong,
    playerStore,
    setDuration,
    setEnginePlaying,
    setEffectiveSong,
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

  /**
   * Tells the OS where in the track playback is, so the lock screen draws a
   * scrubber that moves rather than a static bar.
   *
   * Called on the events that change position discontinuously — a track
   * loading, play, pause, a seek — and never per frame: between calls the
   * platform extrapolates from `playbackRate` itself, which is the whole point
   * of the API.
   */
  const publishPosition = useCallback(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (typeof navigator.mediaSession.setPositionState !== 'function') return;
    const state = playerStore.getState();
    const position = positionState(state.duration, state.progress);
    try {
      // Passing `undefined` is the spec's way of clearing it, which is right
      // when there is no track or its length is not known yet.
      navigator.mediaSession.setPositionState(position ?? undefined);
    } catch {
      // A platform that disagrees about what it will accept must not take the
      // audio engine down with it.
    }
  }, [playerStore]);

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
      publishPosition();
    },
    [playerStore, publishPosition, setProgress],
  );

  useEffect(() => {
    if (transportCommand?.type === 'seek') seek(transportCommand.position);
  }, [seek, transportCommand]);

  const stop = useCallback(() => {
    stopEngine();
    setPlaybackIntent(false);
    setStatus(currentSong ? 'paused' : 'idle');
  }, [currentSong, setPlaybackIntent, setStatus, stopEngine]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = currentSong ? new MediaMetadata(mediaMetadataInit(currentSong)) : null;
    navigator.mediaSession.playbackState = !currentSong ? 'none' : isPlaying ? 'playing' : 'paused';
    publishPosition();

    const registerAction = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Browsers may expose Media Session while omitting individual actions.
      }
    };

    // Seeking relative to wherever playback has reached, which is what a
    // headset's skip buttons and a car stereo send. `seekOffset` is optional in
    // the spec and most platforms omit it.
    const seekBy = (delta: number) => (details: MediaSessionActionDetails) => {
      const offset = details.seekOffset ?? DEFAULT_SEEK_OFFSET_SECONDS;
      seek(playerStore.getState().progress + delta * offset);
    };

    registerAction('play', currentSong ? () => setPlaybackIntent(true) : null);
    registerAction('pause', currentSong ? () => setPlaybackIntent(false) : null);
    registerAction('stop', currentSong ? stop : null);
    registerAction('nexttrack', currentSong ? next : null);
    registerAction('previoustrack', currentSong ? previous : null);
    registerAction('seekbackward', currentSong ? seekBy(-1) : null);
    registerAction('seekforward', currentSong ? seekBy(1) : null);
    registerAction(
      'seekto',
      currentSong
        ? (details) => {
            if (details.seekTime !== undefined) seek(details.seekTime);
          }
        : null,
    );

    return () => {
      for (const action of MEDIA_SESSION_ACTIONS) registerAction(action, null);
    };
  }, [currentSong, isPlaying, next, playerStore, previous, publishPosition, seek, setPlaybackIntent, stop]);

  // Duration only arrives once the track has loaded, which is after the effect
  // above has already run for this song. Seeks publish from `seek` itself.
  useEffect(publishPosition, [duration, publishPosition]);

  /**
   * Stops playback when the sleep timer runs out.
   *
   * One timeout for the whole wait rather than a ticking interval: the store
   * holds the end time, so the only thing that has to happen on a schedule is
   * the stop itself. A backgrounded tab throttles timers but still fires them,
   * and the deadline is re-read on every wake, so a late timer stops playback
   * late rather than never.
   */
  useEffect(() => {
    if (sleepTimerEndsAt === null) return;
    const timer = setTimeout(
      () => {
        const state = playerStore.getState();
        state.setPlaybackIntent(false);
        state.setSleepTimer(null);
      },
      Math.max(0, sleepTimerEndsAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [playerStore, sleepTimerEndsAt]);

  useEffect(() => stopEngine, [stopEngine]);

  const getHowl = useCallback(() => howlRef.current, []);

  return <AudioCtx value={{ seek, stop, getHowl }}>{children}</AudioCtx>;
}

export function useAudio() {
  const context = useContext(AudioCtx);
  if (!context) throw new Error('useAudio must be inside AudioProvider');
  return context;
}
