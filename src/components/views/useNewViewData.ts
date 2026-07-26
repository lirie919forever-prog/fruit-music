'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type FederatedResult } from '@/lib/api';
import { catalogStaleTime, countListResults } from '@/lib/catalogFreshness';
import { interleaveSongGroups, uniqueAlbumSongs } from './newViewModel';
import type { Song } from '@/types/music';

type ChartKey = 'billboard' | 'uk' | 'jp';

/**
 * Everything the New view loads and everything it derives from that.
 *
 * Split out because the component was doing three jobs in one 610-line file:
 * fetching eight feeds, folding them into five different mixes, and rendering
 * fourteen presentational pieces. The fetching and folding have nothing to do
 * with the markup and are the part worth reading on its own.
 */

const shared = {
  staleTime: catalogStaleTime(countListResults),
  retry: 1,
} as const;

function useChart(key: string[], chart: ChartKey) {
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }): Promise<Song[]> => api.getChartSongs(chart, signal),
    ...shared,
  });
}

function useJamendo(key: string[], tag: string) {
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }): Promise<Song[]> => api.getSongsByTag(tag, 30, signal),
    ...shared,
  });
}

function useCCMixter(key: string[], tag: string) {
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }): Promise<FederatedResult<Song>> => api.getCcmixterSongsByTag(tag, 30, signal),
    ...shared,
  });
}

function useTrending() {
  return useQuery({
    queryKey: ['new', 'trending'],
    queryFn: ({ signal }): Promise<FederatedResult<Song>> => api.getTrending(30, signal),
    ...shared,
  });
}

function collectUnavailable(result: FederatedResult<Song> | undefined, issues: Set<string>): void {
  if (!result) return;
  for (const provider of result.failedProviders) issues.add(provider);
  for (const provider of result.degradedProviders ?? []) issues.add(provider);
}

export function useNewViewData() {
  const trending = useTrending();
  const pop = useJamendo(['new', 'featured'], 'pop');
  const jazz = useCCMixter(['new', 'jazz'], 'jazz');
  const remix = useCCMixter(['new', 'remix'], 'remix');
  const classical = useJamendo(['new', 'classical'], 'classical');
  const billboard = useChart(['new', 'billboard'], 'billboard');
  const uk = useChart(['new', 'uk'], 'uk');
  const jp = useChart(['new', 'jp'], 'jp');

  const popData = pop.data;
  const trendingData = trending.data?.results;
  const jazzData = jazz.data?.results;
  const remixData = remix.data?.results;
  const classicalData = classical.data;
  const billboardData = billboard.data;
  const ukData = uk.data;
  const jpData = jp.data;

  // These interleaves walk every loaded shelf and rebuild an array each time.
  // In the component they recomputed on any state it subscribed to, and it
  // subscribes to playback history — so every track that started playing re-ran
  // all of them, though none of them reads history. The dependency lists name
  // the shelves, so they only rerun when one actually changes.
  // Only the release shelf reads this mix, so it is not returned: a hook that
  // hands back a value nobody uses is one more thing a reader has to check.
  const verifiedMix = useMemo(
    () => interleaveSongGroups([popData, trendingData, jazzData, remixData, classicalData], 48),
    [popData, trendingData, jazzData, remixData, classicalData],
  );
  const spotlightSongs = useMemo(
    () => interleaveSongGroups([popData, trendingData, billboardData, jpData, ukData, jazzData, remixData], 2),
    [popData, trendingData, billboardData, jpData, ukData, jazzData, remixData],
  );
  const bestNewSongs = useMemo(
    () =>
      interleaveSongGroups(
        [billboardData, jpData, trendingData, popData, ukData, jazzData, remixData, classicalData],
        12,
      ),
    [billboardData, jpData, trendingData, popData, ukData, jazzData, remixData, classicalData],
  );
  const releaseSongs = useMemo(() => uniqueAlbumSongs(verifiedMix, 10), [verifiedMix]);

  const queries = [trending, pop, jazz, remix, classical, billboard, uk, jp];

  const unavailableSources = useMemo(() => {
    const issues = new Set<string>();
    if (pop.isError || classical.isError) issues.add('Jamendo');
    if (jazz.isError || remix.isError) issues.add('ccMixter');
    collectUnavailable(trending.data, issues);
    collectUnavailable(jazz.data, issues);
    collectUnavailable(remix.data, issues);
    if (billboard.isError || uk.isError || jp.isError) issues.add('Apple Preview');
    return [...issues];
  }, [
    pop.isError,
    classical.isError,
    jazz.isError,
    remix.isError,
    trending.data,
    jazz.data,
    remix.data,
    billboard.isError,
    uk.isError,
    jp.isError,
  ]);

  return {
    charts: { billboard, uk, jp },
    // The genre panels render one shelf each, so they need the raw lists as
    // well as the mixes derived from them.
    genres: {
      pop: popData ?? [],
      jazz: jazzData ?? [],
      remix: remixData ?? [],
      classical: classicalData ?? [],
    },
    spotlightSongs,
    bestNewSongs,
    releaseSongs,
    unavailableSources,
    isLoading: queries.some((query) => query.isPending || query.isFetching),
    retry: () => {
      void Promise.all(queries.map((query) => query.refetch()));
    },
  };
}
