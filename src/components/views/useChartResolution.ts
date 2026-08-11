'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMusicCatalog } from '@/lib/musicCatalog';
import { isFullTrack } from './newViewModel';
import { isPreviewSource } from '@/lib/sourceRegistry';
import type { Song } from '@/types/music';

const RESOLUTION_WORKERS = 8;
const RESOLUTION_TIMEOUT_MS = 35_000;

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
 * State updates are batched. The worker pool fires many `resolveChartTrack`
 * calls in parallel; if each resolution wrote straight into React state the
 * burst of `setResolvedMap` commits across the same render window tripped
 * the React "Maximum update depth exceeded" guard on small viewports. We
 * accumulate resolved tracks in a local mutable buffer and flush them on a
 * single setTimeout(0) tick so many worker completions collapse into one
 * commit per flush - the chart upgrades visibly, without the warning.
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

  useEffect(() => {
    if (!enabled || songs.length === 0) return;
    const controller = new AbortController();
    const signal = controller.signal;
    let nextIndex = 0;

    // Mutable buffer + a single scheduled flush. A new buffer is built per
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
        setResolvedMap((prev) => {
          const next = new Map(prev);
          for (const [id, full] of batch) next.set(id, full);
          return next;
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