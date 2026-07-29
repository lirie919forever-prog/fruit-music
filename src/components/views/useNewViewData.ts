'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type FederatedResult } from '@/lib/api';
import { catalogStaleTime, countListResults } from '@/lib/catalogFreshness';
import { interleaveSongGroups, interleaveSongsByProvider, uniqueAlbumSongs } from './newViewModel';
import type { Song } from '@/types/music';

/**
 * Everything the New view loads and everything it derives from that.
 *
 * Split out because the component was doing three jobs in one large file:
 * fetching catalog feeds, folding them into five different mixes, and rendering
 * fourteen presentational pieces. The fetching and folding have nothing to do
 * with the markup and are the part worth reading on its own.
 */

const shared = {
  staleTime: catalogStaleTime(countListResults),
  retry: 1,
} as const;

function useGenre(key: string[], tag: string) {
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }): Promise<FederatedResult<Song>> => api.getGenreSongs(tag, 30, signal),
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

function useLiveStations() {
  return useQuery({
    queryKey: ['new', 'live-stations'],
    queryFn: ({ signal }): Promise<FederatedResult<Song>> => api.getLiveStations(12, signal),
    ...shared,
  });
}

function useRecentReleases() {
  return useQuery({
    queryKey: ['new', 'recent-releases'],
    queryFn: ({ signal }): Promise<Song[]> => api.getRecentReleases(18, signal),
    ...shared,
  });
}

function hasFailedProvider(result: FederatedResult<Song> | undefined): boolean {
  return (result?.failedProviders.length ?? 0) > 0;
}

export function useNewViewData() {
  const trending = useTrending();
  const liveStations = useLiveStations();
  const pop = useGenre(['new', 'genre', 'pop'], 'pop');
  const jazz = useGenre(['new', 'genre', 'jazz'], 'jazz');
  const remix = useGenre(['new', 'genre', 'remix'], 'remix');
  const classical = useGenre(['new', 'genre', 'classical'], 'classical');
  const recentReleases = useRecentReleases();

  const popData = pop.data?.results;
  const trendingData = trending.data?.results;
  const liveStationData = liveStations.data?.results;
  const jazzData = jazz.data?.results;
  const remixData = remix.data?.results;
  const classicalData = classical.data?.results;
  const recentReleaseData = recentReleases.data;

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
    () =>
      uniqueAlbumSongs(
        interleaveSongsByProvider([recentReleaseData, trendingData, popData, jazzData, remixData], 48),
        12,
      ),
    [recentReleaseData, trendingData, popData, jazzData, remixData],
  );
  const bestNewSongs = useMemo(
    () => interleaveSongsByProvider([trendingData, recentReleaseData, popData, jazzData, remixData, classicalData], 48),
    [trendingData, recentReleaseData, popData, jazzData, remixData, classicalData],
  );
  const releaseSongs = useMemo(
    () => uniqueAlbumSongs(interleaveSongGroups([recentReleaseData, verifiedMix], 64), 24),
    [recentReleaseData, verifiedMix],
  );
  // The US Chart Watch tab reads the same Billboard feed that contributes
  // Apple tracks to trending. Keep those entries so the deferred chart can
  // render from discovery data instead of requesting the same feed again.
  const billboardSongs = useMemo(
    () => (trendingData ?? []).filter((song) => song.provider === 'Apple Preview').slice(0, 6),
    [trendingData],
  );

  const queries = [trending, liveStations, pop, jazz, remix, classical, recentReleases];

  const hasCatalogFailure = useMemo(() => {
    return (
      hasFailedProvider(trending.data) ||
      hasFailedProvider(liveStations.data) ||
      hasFailedProvider(pop.data) ||
      hasFailedProvider(jazz.data) ||
      hasFailedProvider(remix.data) ||
      hasFailedProvider(classical.data) ||
      recentReleases.isError
    );
  }, [trending.data, liveStations.data, pop.data, jazz.data, remix.data, classical.data, recentReleases.isError]);

  return {
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
    liveStations: liveStationData ?? [],
    releaseSongs,
    billboardSongs,
    hasCatalogFailure,
    isLoading: queries.some((query) => query.isPending),
    retry: () => {
      void Promise.all(queries.map((query) => query.refetch()));
    },
  };
}
