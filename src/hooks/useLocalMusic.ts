'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Song } from '@/types/music';
import {
  clearLocalFiles,
  desktopSelectionToSong,
  importLocalFiles,
  isDesktopLocalSong,
  loadLocalSongs,
  removeLocalFile,
  revokeLocalSong,
} from '@/lib/localMusic';
import { getDesktopBridge } from '@/lib/desktopBridge';
import { useToast } from '@/components/ui/Toast';
import { usePlayerStoreApi } from '@/store/playerStore';

async function loadDesktopSongs(): Promise<Song[]> {
  const bridge = getDesktopBridge();
  if (!bridge) return [];
  try {
    const selections = await bridge.listAudioFiles();
    const results = await Promise.allSettled(selections.map((selection) => desktopSelectionToSong(selection, bridge)));
    return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  } catch {
    // Browser-file imports remain usable when the optional desktop bridge has
    // no saved library or an old install cannot migrate one of its entries.
    return [];
  }
}

function mergeSongs(current: Song[], imported: Song[]): Song[] {
  const importedById = new Map(imported.map((song) => [song.id, song]));
  current.forEach((song) => {
    if (importedById.get(song.id)?.path !== song.path) revokeLocalSong(song);
  });
  return [...current.filter((song) => !importedById.has(song.id)), ...imported];
}

export function useLocalMusic() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { push } = useToast();
  const playerStore = usePlayerStoreApi();
  const songsRef = useRef<Song[]>([]);

  useEffect(() => {
    songsRef.current = songs;
  }, [songs]);

  useEffect(() => {
    let active = true;
    let unsubscribeHydration: (() => void) | null = null;

    const reconcileWhenHydrated = (loaded: Song[]) => {
      const apply = () => {
        if (active) playerStore.getState().reconcileLocalSongs(loaded);
      };

      if (playerStore.persist.hasHydrated()) {
        apply();
        return;
      }

      unsubscribeHydration = playerStore.persist.onFinishHydration(() => {
        unsubscribeHydration?.();
        unsubscribeHydration = null;
        apply();
      });

      // Avoid losing the reconciliation if hydration completed between the
      // check above and listener registration.
      if (playerStore.persist.hasHydrated()) {
        unsubscribeHydration();
        unsubscribeHydration = null;
        apply();
      }
    };

    void Promise.all([loadLocalSongs(), loadDesktopSongs()])
      .then(([browserSongs, desktopSongs]) => {
        const loaded = mergeSongs(browserSongs, desktopSongs);
        if (active) {
          setSongs(loaded);
          reconcileWhenHydrated(loaded);
        }
      })
      .catch(() => {
        if (active) {
          const message = 'The local music library could not be opened.';
          setError(message);
          push(message, 'error');
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      unsubscribeHydration?.();
      songsRef.current.forEach(revokeLocalSong);
    };
  }, [playerStore, push]);

  const importFiles = useCallback(
    async (files: File[]) => {
      setError(null);
      let imported: Song[];
      try {
        imported = await importLocalFiles(files);
      } catch {
        const message = 'The selected audio could not be imported.';
        setError(message);
        push(message, 'error');
        return;
      }
      if (imported.length === 0) {
        const message = 'Choose an audio file such as MP3, M4A, OGG, WAV, or FLAC.';
        setError(message);
        push(message, 'info');
        return;
      }
      setSongs((current) => mergeSongs(current, imported));
      playerStore.getState().reconcileLocalSongs(imported);
    },
    [playerStore, push],
  );

  const importDesktopFiles = useCallback(async () => {
    const bridge = getDesktopBridge();
    if (!bridge) {
      const message = 'Desktop file import is available only in the Marea desktop app.';
      setError(message);
      push(message, 'info');
      return;
    }

    try {
      const selections = await bridge.selectAudioFiles();
      const results = await Promise.allSettled(
        selections.map((selection) => desktopSelectionToSong(selection, bridge)),
      );
      const imported = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
      if (imported.length === 0) return;
      setSongs((current) => mergeSongs(current, imported));
      playerStore.getState().reconcileLocalSongs(imported);
    } catch {
      const message = 'The selected desktop audio could not be imported.';
      setError(message);
      push(message, 'error');
    }
  }, [playerStore, push]);

  const removeSong = useCallback(
    async (song: Song) => {
      try {
        if (isDesktopLocalSong(song)) {
          const bridge = getDesktopBridge();
          if (!bridge) throw new Error('Desktop bridge unavailable');
          await bridge.removeAudioFile(song.id);
        } else {
          await removeLocalFile(song.id);
        }
      } catch {
        const message = 'The local library entry could not be removed.';
        setError(message);
        push(message, 'error');
        return;
      }
      playerStore.getState().removeLocalSongReferences(song.id);
      setSongs((current) => current.filter((item) => item.id !== song.id));
      revokeLocalSong(song);
    },
    [playerStore, push],
  );

  const clear = useCallback(async () => {
    const currentSongs = songsRef.current;
    try {
      const bridge = getDesktopBridge();
      await Promise.all([clearLocalFiles(), bridge ? bridge.clearAudioFiles() : Promise.resolve(true)]);
    } catch {
      const message = 'The local library could not be cleared.';
      setError(message);
      push(message, 'error');
      return;
    }
    playerStore.getState().removeLocalSongReferences(currentSongs.map((song) => song.id));
    setSongs((current) => {
      current.forEach(revokeLocalSong);
      return [];
    });
  }, [playerStore, push]);

  return { songs, isLoading, error, importFiles, importDesktopFiles, removeSong, clear };
}
