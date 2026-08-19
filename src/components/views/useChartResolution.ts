'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMusicCatalog } from '@/lib/musicCatalog';
import { isFullTrack } from './newViewModel';
import type { Song } from '@/types/music';

const RESOLUTION_WORKERS = 8;
const RESOLUTION_TIMEOUT_MS = 35_000;
const EMPTY_RESOLVED_TRACKS: ReadonlyMap<string, Song> = new Map();

/**
 * Progressive chart hydration hook. The server-side chart fetch returns raw
 * Apple previews immediately so the page paints the full ranked chart within
 * ~1s. This hook then spawns a worker pool that upgrades individual preview
 * slots to verified full-length matches, replacing each preview at its chart
 * position as the resolver finds a match. This is non-blocking: rendered
 * tracks never leave the screen, only become "full" as they upgrade.
 *
 * Tracks are keyed by their original Apple-preview ID so the merged list
 * keeps the chart ranking intact (the same list of slots, each replaced in
 * place when a full-track match is verified).
 *
 * Reference stability: the resolver effect depends only on a STABLE content
 * fingerprint (the joined ids) and the enabled flag - never on the `songs`
 * array or the `catalog` object identities. Either of those can flip
 * reference on every render (React Query refetch, parent re-render, a
 * context value that is not memoized upstream); depending on them respawned
 * the entire worker pool on every flush, which tripped React's "Maximum
 * update depth exceeded" guard on the Japan chart. Latest snapshots are held
 * in refs so the workers always read the newest data without re-subscribing.
 *
 * State updates are batched: worker completions accumulate in a mutable buffer
 * that flushes on a single setTimeout(0) tick so many completions collapse
 * into one commit, instead of each resolution writing straight into state.
 */
export function useChartResolution(songs: Song[], enabled: boolean): Song[] {
  const catalog = useMusicCatalog();

  // Content fingerprint: stable across renders that hand in a new array
  // reference with the same ids. Only a real content change (different ids)
  // restarts hydration; a reference-only change is a no-op for the effects.
  const songsKey = useMemo(() => songs.map((song) => song.id).join('\n'), [songs]);
  const [resolutionState, setResolutionState] = useState<{
    songsKey: string;
    tracks: ReadonlyMap<string, Song>;
  }>(() => ({ songsKey, tracks: EMPTY_RESOLVED_TRACKS }));
  const resolvedMap = resolutionState.songsKey === songsKey ? resolutionState.tracks : EMPTY_RESOLVED_TRACKS;

  // Latest snapshots in refs. The resolver effect reads these so it can
  // depend on the stable content key instead of the array/catalog objects,
  // which would otherwise respawn workers on every flush.
  const songsRef = useRef(songs);
  const catalogRef = useRef(catalog);
  useEffect(() => {
    songsRef.current = songs;
    catalogRef.current = catalog;
  }, [catalog, songs]);

  useEffect(() => {
    if (!enabled || songsKey === '') return;
    const controller = new AbortController();
    const signal = controller.signal;
    let nextIndex = 0;

    // Mutable buffer + a single scheduled flush. A fresh buffer is built per
    // flush so an in-flight probe can keep appending into the active one
    // without racing the state setter below.
    const buffer = { pending: new Map<string, Song>(), scheduled: false };
    const scheduleFlush = () => {
      if (buffer.scheduled) return;
      buffer.scheduled = true;
      const flushTimer = setTimeout(() => {
        buffer.scheduled = false;
        const batch = buffer.pending;
        if (batch.size === 0) return;
        buffer.pending = new Map();
        setResolutionState((previous) => {
          const next = new Map(previous.songsKey === songsKey ? previous.tracks : EMPTY_RESOLVED_TRACKS);
          for (const [id, full] of batch) next.set(id, full);
          return { songsKey, tracks: next };
        });
      }, 0);
      // If the abort fires while a flush is pending, skip the empty flush.
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(flushTimer);
          buffer.scheduled = false;
        },
        { once: true },
      );
    };

    void Promise.all(
      Array.from({ length: Math.min(RESOLUTION_WORKERS, songsRef.current.length) }, async () => {
        while (nextIndex < songsRef.current.length) {
          if (signal.aborted) return;
          const original = songsRef.current[nextIndex++];
          // Skip tracks that are already full-length. Even with the chart
          // preview response, a stale React Query cache can contain mixed
          // preview + full rows from a previous progressive upgrade; we
          // never want to upgrade them twice.
          if (isFullTrack(original)) continue;
          try {
            const full = await catalogRef.current.resolveChartTrack(original, signal);
            if (full && !signal.aborted) {
              buffer.pending.set(original.id, full);
              scheduleFlush();
            }
          } catch {
            // A single track that fails to resolve should not stop the rest.
            if (signal.aborted) return;
          }
        }
      }),
    );

    const timeoutId = setTimeout(
      () => controller.abort(new DOMException('Chart resolution complete', 'AbortError')),
      RESOLUTION_TIMEOUT_MS,
    );

    return () => {
      clearTimeout(timeoutId);
      if (!controller.signal.aborted) controller.abort();
    };
    // Depend only on the stable content key + the enabled flag. songsRef /
    // catalogRef hold the latest snapshots; depending on the array or catalog
    // identities respawns the whole worker pool on every flush, which is the
    // max-depth loop we deliberately avoid here.
  }, [songsKey, enabled]);

  return useMemo(() => {
    if (resolvedMap.size === 0) return songs;
    return songs.map((song) => resolvedMap.get(song.id) ?? song);
  }, [songs, resolvedMap]);
}
