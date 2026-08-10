'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FederatedResult, MusicCatalog } from '@/lib/catalogTypes';
import { useMusicCatalog } from '@/lib/musicCatalog';
import { catalogStaleTime, countListResults } from '@/lib/catalogFreshness';
import { interleaveSongGroups, interleaveSongsByProvider, isCuratableTitle, uniqueAlbumSongs } from './newViewModel';
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

function useRecentReleases(catalog: MusicCatalog, enabled = true) {
  return useQuery({
    queryKey: ['new', 'recent-releases'],
    queryFn: ({ signal }): Promise<Song[]> => catalog.getRecentReleases(12, signal),
    enabled,
    ...shared,
  });
}

function useMainstreamChart(catalog: MusicCatalog, enabled = true) {
  return useQuery({
    // The home shelf has its own bounded hydration budget so it does not
    // share the expensive 50-row dedicated-chart request and can resolve
    // quickly enough for the first paint.
    queryKey: ['new', 'chart', 'billboard', 'shelf'],
    queryFn: ({ signal }): Promise<Song[]> =>
      catalog.getChartSongs('billboard', signal, { resolveFullTracks: true, rowLimit: 18 }),
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
  primaryDiscoveryReady: boolean;
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

export function useNewViewData({ enableGenres = true }: { enableGenres?: boolean } = {}): NewViewData {
  const catalog = useMusicCatalog();
  // Start the first listening shelf immediately, then introduce lower-page
  // federation in small waves. This keeps a cold mobile load from launching
  // every source, genre, chart resolver, and recent-release seed at once.
  const trending = useTrending(catalog);
  const liveStationsEnabled = useDelayedEnable(350);
  const recentReleasesEnabled = useDelayedEnable(900);
  const liveStations = useLiveStations(catalog, liveStationsEnabled);
  const recentReleases = useRecentReleases(catalog, recentReleasesEnabled);
  // Chart resolution has the broadest matching path, so it waits until the
  // initial discovery and live shelves have had room to paint.
  const chartEnabled = useDelayedEnable(1_500);
  const mainstreamChart = useMainstreamChart(catalog, chartEnabled);
  // Genre shelves are below the primary listening choices. The view activates
  // them near the shelf instead of spending a cold mobile load on music the
  // listener has not reached yet.
  const pop = useGenre(catalog, ['new', 'genre', 'pop'], 'pop', enableGenres);
  const jazz = useGenre(catalog, ['new', 'genre', 'jazz'], 'jazz', enableGenres);
  const remix = useGenre(catalog, ['new', 'genre', 'remix'], 'remix', enableGenres);
  const classical = useGenre(catalog, ['new', 'genre', 'classical'], 'classical', enableGenres);

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
    () =>
      uniqueAlbumSongs(interleaveSongsByProvider([trendingData, popData, jazzData, remixData], 48), 12).filter(
        isCuratableTitle,
      ),
    [trendingData, popData, jazzData, remixData],
  );
  const bestNewSongs = useMemo(
    () =>
      interleaveSongsByProvider([trendingData, popData, jazzData, remixData, classicalData], 48).filter(
        isCuratableTitle,
      ),
    [trendingData, popData, jazzData, remixData, classicalData],
  );
  const releaseSongs = useMemo(
    () => uniqueAlbumSongs([...(recentReleases.data ?? []), ...verifiedMix], 24).filter(isCuratableTitle),
    [recentReleases.data, verifiedMix],
  );

  const federatedQueries = [trending, liveStations, pop, jazz, remix, classical];

  const hasCatalogFailure =
    recentReleases.isError ||
    mainstreamChart.isError ||
    federatedQueries.some((query) => query.isError || hasFailedProvider(query.data));
  const hasSettledCatalogQuery = [recentReleases, mainstreamChart, ...federatedQueries].some(
    (query) => query.isFetched,
  );
  const isInitialLoading =
    !hasSettledCatalogQuery &&
    (recentReleases.isFetching || mainstreamChart.isFetching || federatedQueries.some((query) => query.isFetching));
  const primaryDiscoveryReady =
    trending.isFetched && liveStations.isFetched && recentReleases.isFetched && mainstreamChart.isFetched;

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
    isLoading: isInitialLoading,
    primaryDiscoveryReady,
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
