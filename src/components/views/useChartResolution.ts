'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMusicCatalog } from '@/lib/musicCatalog';
import { isFullTrack } from './newViewModel';
import { isPreviewSource } from '@/lib/sourceRegistry';
import type { Song } from '@/types/music';

const RESOLUTION_WORKERS = 12;
const RESOLUTION_TIMEOUT_MS = 50_000;

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
 */
export function useChartResolution(songs: Song[], enabled: boolean): Song[] {
  const catalog = useMusicCatalog();
  const [resolvedMap, setResolvedMap] = useState<ReadonlyMap<string, Song>>(new Map());

  // Reset the upgrade map whenever the underlying chart data changes (a
  // refetch replaces the entire list). Without this, a stale resolver would
  // mix the previous chart's tracks with the new list.
  useEffect(() => {
    setResolvedMap(new Map());
  }, [songs]);

  // Coalesce a burst of successful resolutions into a single state update so
  // the parallel probe race (which can resolve several chart rows within the
  // same microtask) does not trip React's maximum update depth guard or
  // schedule one render per row. The queue is flushed at most once per
  // microtask; each flush replaces the state with a single new Map snapshot
  // carrying all of the rows that resolved since the last flush.
  const pendingRef = useRef<Map<string, Song>>(new Map());
  const flushScheduledRef = useRef(false);
  const flushPending = () => {
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    queueMicrotask(() => {
      flushScheduledRef.current = false;
      const batch = pendingRef.current;
      if (batch.size === 0) return;
      pendingRef.current = new Map();
      setResolvedMap((prev) => {
        const next = prev.size === 0 ? new Map<string, Song>() : new Map(prev);
        for (const [k, v] of batch) next.set(k, v);
        return next;
      });
    });
  };
  const upsertResolved = (id: string, song: Song) => {
    pendingRef.current.set(id, song);
    flushPending();
  };

  useEffect(() => {
    if (!enabled || songs.length === 0) return;
    const controller = new AbortController();
    const signal = controller.signal;
    let nextIndex = 0;

    void Promise.all(
      Array.from({ length: Math.min(RESOLUTION_WORKERS, songs.length) }, async () => {
        while (nextIndex < songs.length) {
          if (signal.aborted) return;
          const original = songs[nextIndex++];
          // Skip tracks that are already full-length. Even with the chart
          // preview response, a stale React Query cache can contain mixed
          // preview + full rows from a previous progressive upgrade; we
          // never want to upgrade them twice.
          if (isFullTrack(original)) continue;
          try {
            const full = await catalog.resolveChartTrack(original, signal);
            if (full && !signal.aborted) {
              upsertResolved(original.id, full);
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
  }, [songs, enabled, catalog]);

  return useMemo(() => {
    if (resolvedMap.size === 0) return songs;
    return songs.map((song) => resolvedMap.get(song.id) ?? song);
  }, [songs, resolvedMap]);
}

/**
 * Returns whether the chart songs still contain Apple/preview clips that
 * have not yet been upgraded. The CategoryGrid uses this to show a live
 * "X full + Y preview" message that increments as tracks upgrade.
 */
export function countChartProvenance(songs: Song[]): { full: number; preview: number } {
  let full = 0;
  let preview = 0;
  for (const song of songs) {
    if (song.playbackUnavailable) continue;
    if (isPreviewSource(song.provider)) preview += 1;
    else if (isFullTrack(song)) full += 1;
  }
  return { full, preview };
}