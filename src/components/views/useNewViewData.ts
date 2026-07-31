'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type FederatedResult } from '@/lib/api';
import { catalogStaleTime, countListResults } from '@/lib/catalogFreshness';
import { interleaveSongGroups, interleaveSongsByProvider, uniqueAlbumSongs } from './newViewModel';
import type { Song } from '@/types/music';

const shared = {
  staleTime: catalogStaleTime(countListResults),
  retry: 1,
} as const;

function useGenre(key: string[], tag: string, enabled = true) {
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }): Promise<FederatedResult<Song>> => api.getGenreSongs(tag, 30, signal),
    enabled,
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

function useLiveStations(enabled = true) {
  return useQuery({
    queryKey: ['new', 'live-stations'],
    queryFn: ({ signal }): Promise<FederatedResult<Song>> => api.getLiveStations(12, signal),
    enabled,
    ...shared,
  });
}

function hasFailedProvider(result: FederatedResult<Song> | undefined): boolean {
  return (result?.failedProviders.length ?? 0) > 0;
}

export function useNewViewData() {
  const trending = useTrending();
  const discoveryReady = trending.isFetched;
  const liveStations = useLiveStations(discoveryReady);
  const pop = useGenre(['new', 'genre', 'pop'], 'pop', discoveryReady);
  const jazz = useGenre(['new', 'genre', 'jazz'], 'jazz', discoveryReady);
  const remix = useGenre(['new', 'genre', 'remix'], 'remix', discoveryReady);
  const classical = useGenre(['new', 'genre', 'classical'], 'classical', discoveryReady);

  const popData = pop.data?.results;
  const trendingData = trending.data?.results;
  const liveStationData = liveStations.data?.results;
  const jazzData = jazz.data?.results;
  const remixData = remix.data?.results;
  const classicalData = classical.data?.results;

  const verifiedMix = useMemo(
    () => interleaveSongGroups([popData, trendingData, jazzData, remixData, classicalData], 48),
    [popData, trendingData, jazzData, remixData, classicalData],
  );
  const spotlightSongs = useMemo(
    () => uniqueAlbumSongs(interleaveSongsByProvider([trendingData, popData, jazzData, remixData], 48), 12),
    [trendingData, popData, jazzData, remixData],
  );
  const bestNewSongs = useMemo(
    () => interleaveSongsByProvider([trendingData, popData, jazzData, remixData, classicalData], 48),
    [trendingData, popData, jazzData, remixData, classicalData],
  );
  const releaseSongs = useMemo(() => uniqueAlbumSongs(verifiedMix, 24), [verifiedMix]);
  const billboardSongs = useMemo(
    () => (trendingData ?? []).filter((song) => song.provider === 'Apple Preview').slice(0, 6),
    [trendingData],
  );

  const queries = [trending, liveStations, pop, jazz, remix, classical];

  const hasCatalogFailure = queries.some((query) => query.isError || hasFailedProvider(query.data));

  return {
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
    isLoading: queries.some((query) => query.isFetching),
    retry: () => {
      void Promise.all(queries.map((query) => query.refetch()));
    },
  };
}
