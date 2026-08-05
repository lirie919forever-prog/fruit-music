'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FederatedResult, MusicCatalog } from '@/lib/catalogTypes';
import { useMusicCatalog } from '@/lib/musicCatalog';
import { catalogStaleTime, countListResults } from '@/lib/catalogFreshness';
import { interleaveSongGroups, interleaveSongsByProvider, uniqueAlbumSongs } from './newViewModel';
import type { Song } from '@/types/music';

const shared = {
  staleTime: catalogStaleTime(countListResults),
  retry: 1,
} as const;

function useGenre(catalog: MusicCatalog, key: string[], tag: string, enabled = true) {
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }): Promise<FederatedResult<Song>> => catalog.getGenreSongs(tag, 30, signal),
    enabled,
    ...shared,
  });
}

function useTrending(catalog: MusicCatalog) {
  return useQuery({
    queryKey: ['new', 'trending'],
    queryFn: ({ signal }): Promise<FederatedResult<Song>> => catalog.getTrending(30, signal),
    ...shared,
  });
}

function useRecentReleases(catalog: MusicCatalog) {
  return useQuery({
    queryKey: ['new', 'recent-releases'],
    queryFn: ({ signal }): Promise<Song[]> => catalog.getRecentReleases(24, signal),
    ...shared,
  });
}

function useMainstreamChart(catalog: MusicCatalog, enabled = true) {
  return useQuery({
    queryKey: ['new', 'chart', 'billboard'],
    queryFn: ({ signal }): Promise<Song[]> => catalog.getChartSongs('billboard', signal),
    enabled,
    ...shared,
  });
}

function useLiveStations(catalog: MusicCatalog, enabled = true) {
  return useQuery({
    queryKey: ['new', 'live-stations'],
    queryFn: ({ signal }): Promise<FederatedResult<Song>> => catalog.getLiveStations(12, signal),
    enabled,
    ...shared,
  });
}

function hasFailedProvider(result: FederatedResult<Song> | undefined): boolean {
  return (result?.failedProviders.length ?? 0) > 0;
}

function useDelayedEnable(delayMs: number): boolean {
  const [enabled, setEnabled] = useState(delayMs === 0);
  useEffect(() => {
    if (delayMs === 0) return;
    const timer = setTimeout(() => setEnabled(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);
  return enabled;
}

export interface NewViewSectionState {
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  isFetched: boolean;
  failedProviders: string[];
  degradedProviders: string[];
}

export interface NewViewData {
  genres: {
    pop: Song[];
    jazz: Song[];
    remix: Song[];
    classical: Song[];
  };
  spotlightSongs: Song[];
  bestNewSongs: Song[];
  liveStations: Song[];
  releaseSongs: Song[];
  mainstreamSongs: Song[];
  hasCatalogFailure: boolean;
  isLoading: boolean;
  retry: () => void;
  sections: {
    trending: NewViewSectionState;
    liveStations: NewViewSectionState;
    pop: NewViewSectionState;
    jazz: NewViewSectionState;
    remix: NewViewSectionState;
    classical: NewViewSectionState;
    chart: NewViewSectionState;
  };
}

interface QueryStateLike {
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  isFetched: boolean;
  data?: unknown;
}

function sectionState(query: QueryStateLike): NewViewSectionState {
  const data = query.data as FederatedResult<Song> | undefined;
  return {
    isPending: query.isPending,
    isFetching: query.isFetching,
    isError: query.isError,
    isFetched: query.isFetched,
    failedProviders: data?.failedProviders ?? [],
    degradedProviders: data?.degradedProviders ?? [],
  };
}

export function useNewViewData(): NewViewData {
  const catalog = useMusicCatalog();
  // Every section starts in parallel. Trending no longer gates the rest:
  // live stations and each genre shelf load concurrently, so the first
  // meaningful content paints as soon as any provider responds rather than
  // waiting for the slowest trending seed to finish first.
  const trending = useTrending(catalog);
  const liveStations = useLiveStations(catalog);
  const recentReleases = useRecentReleases(catalog);
  // The chart resolver is deliberately delayed until the first discovery
  // shelves have started painting. It is the strongest mainstream signal, but
  // its full-track matching fans out to several upstream lookups.
  const chartEnabled = useDelayedEnable(850);
  const mainstreamChart = useMainstreamChart(catalog, chartEnabled);
  // Keep the first viewport responsive on a cold load. Each genre still has an
  // independent cache entry, but its federation starts in a small stagger so
  // four shelves cannot create a 20+ request burst at the same moment.
  const popEnabled = useDelayedEnable(250);
  const jazzEnabled = useDelayedEnable(400);
  const remixEnabled = useDelayedEnable(550);
  const classicalEnabled = useDelayedEnable(700);
  const pop = useGenre(catalog, ['new', 'genre', 'pop'], 'pop', popEnabled);
  const jazz = useGenre(catalog, ['new', 'genre', 'jazz'], 'jazz', jazzEnabled);
  const remix = useGenre(catalog, ['new', 'genre', 'remix'], 'remix', remixEnabled);
  const classical = useGenre(catalog, ['new', 'genre', 'classical'], 'classical', classicalEnabled);

  const popData = pop.data?.results;
  const trendingData = trending.data?.results;
  const liveStationData = liveStations.data?.results;
  const jazzData = jazz.data?.results;
  const remixData = remix.data?.results;
  const classicalData = classical.data?.results;
  const mainstreamSongs = mainstreamChart.data ?? [];

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
  const releaseSongs = useMemo(
    () => uniqueAlbumSongs([...(recentReleases.data ?? []), ...verifiedMix], 24),
    [recentReleases.data, verifiedMix],
  );

  const federatedQueries = [trending, liveStations, pop, jazz, remix, classical];

  const hasCatalogFailure =
    recentReleases.isError ||
    mainstreamChart.isError ||
    federatedQueries.some((query) => query.isError || hasFailedProvider(query.data));

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
    hasCatalogFailure,
    isLoading:
      recentReleases.isFetching || mainstreamChart.isFetching || federatedQueries.some((query) => query.isFetching),
    retry: () => {
      const retryable = federatedQueries.filter(
        (query) =>
          query.isError || ((query.data as FederatedResult<Song> | undefined)?.failedProviders.length ?? 0) > 0,
      );
      void Promise.all([
        ...retryable.map((query) => query.refetch()),
        ...(recentReleases.isError ? [recentReleases.refetch()] : []),
        ...(mainstreamChart.isError ? [mainstreamChart.refetch()] : []),
      ]);
    },
    sections: {
      trending: sectionState(trending),
      liveStations: sectionState(liveStations),
      pop: sectionState(pop),
      jazz: sectionState(jazz),
      remix: sectionState(remix),
      classical: sectionState(classical),
      chart: sectionState(mainstreamChart),
    },
    mainstreamSongs,
  };
}
