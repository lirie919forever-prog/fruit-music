'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SongCard } from './SongCard';
import { isDirectFullTrack, isFullTrack } from './newViewModel';
import { isPreviewSource } from '@/lib/sourceRegistry';
import { StatusButton, StatusPanel } from '@/components/ui/StatusPanel';
import { providerErrorMessage } from '@/lib/providers/errors';
import { catalogStaleTime, countListResults } from '@/lib/catalogFreshness';
import type { NavigationItem } from '@/lib/navigation';
import type { FederatedResult, MusicCatalog } from '@/lib/catalogTypes';
import type { Song, ViewType } from '@/types/music';
import { VirtualList } from '@/components/ui/VirtualList';
import { useMusicCatalog } from '@/lib/musicCatalog';
import { useChartResolution } from './useChartResolution';

export interface CategoryConfig {
  view: ViewType;
  title: string;
  description: string;
  fetchFn: (catalog: MusicCatalog, signal?: AbortSignal) => Promise<Song[] | FederatedResult<Song>>;
  queryKey: string[];
  includePreviews?: boolean;
  /** Omit catalog-only preview rows when a category promises playable tracks. */
  requiresFullLength?: boolean;
}

export function getCategoryState(data: Song[] | FederatedResult<Song> | undefined) {
  if (!data) return { songs: [], failedProviders: [], degradedProviders: [], totalFailure: false };
  if (Array.isArray(data)) return { songs: data, failedProviders: [], degradedProviders: [], totalFailure: false };
  const failedProviders = data.failedProviders ?? [];
  const degradedProviders = data.degradedProviders ?? [];
  const unavailableProviders = [...new Set([...failedProviders, ...degradedProviders])];
  return {
    songs: data.results,
    failedProviders,
    degradedProviders,
    totalFailure: data.results.length === 0 && unavailableProviders.length === data.providerCount,
  };
}

export function CategoryGrid({
  config,
  onNavigateWithItem,
}: {
  config: CategoryConfig;
  onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void;
}) {
  const catalog = useMusicCatalog();
  const {
    data: categoryState,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: config.queryKey,
    queryFn: ({ signal }) => config.fetchFn(catalog, signal),
    staleTime: catalogStaleTime(countListResults),
  });
  const {
    songs: allSongs,
    failedProviders,
    degradedProviders,
    totalFailure: allProvidersFailed,
  } = getCategoryState(categoryState);
  const unavailableProviders = useMemo(
    () => [...new Set([...failedProviders, ...degradedProviders])],
    [failedProviders, degradedProviders],
  );

  const resolvedSongs = useChartResolution(allSongs, config.requiresFullLength === true);

  // allSongs from resolveChartFullTracks already preserves chart ranking order:
  // full-track matches are in-place at their original chart position, and
  // unmatched positions remain as official Apple previews. Use allSongs
  // directly for chart views to keep the ranking intact - splitting into
  // separate full-track and preview arrays then concatenating scrambles the
  // chart order, which caused track misalignment.
  const displaySongs = useMemo(
    () =>
      config.requiresFullLength || config.includePreviews === true ? resolvedSongs : allSongs.filter(isDirectFullTrack),
    [resolvedSongs, allSongs, config.requiresFullLength, config.includePreviews],
  );
  const fullCount = useMemo(
    () =>
      config.requiresFullLength
        ? resolvedSongs.filter((song) => song.playbackUnavailable !== true && isFullTrack(song)).length
        : displaySongs.length,
    [resolvedSongs, config.requiresFullLength, displaySongs],
  );
  const previewCount = useMemo(
    () =>
      config.requiresFullLength
        ? resolvedSongs.filter((song) => isPreviewSource(song.provider) && song.playbackUnavailable !== true).length
        : 0,
    [resolvedSongs, config.requiresFullLength],
  );
  const isShowingPreviews = previewCount > 0 && config.requiresFullLength;
  const hasUnavailableTracks = useMemo(() => displaySongs.some((song) => song.playbackUnavailable), [displaySongs]);

  if (isLoading) return <TrackSkeleton />;
  if (isError || allProvidersFailed) {
    return (
      <StatusPanel
        eyebrow={`${config.title} unavailable`}
        title={isError ? providerErrorMessage(error) : 'Category providers are unavailable. Please try again.'}
        tone="error"
        actions={<StatusButton onClick={() => void refetch()}>Try again</StatusButton>}
      />
    );
  }
  if (!displaySongs?.length) {
    return (
      <StatusPanel
        eyebrow={config.title}
        title={
          config.requiresFullLength
            ? 'No current chart tracks are available right now.'
            : 'No tracks are available for this category right now.'
        }
        note={
          unavailableProviders.length > 0 ? `Unavailable or degraded: ${unavailableProviders.join(', ')}` : undefined
        }
        actions={<StatusButton onClick={() => void refetch()}>Refresh</StatusButton>}
      />
    );
  }

  return (
    <section className="pb-6">
      {/* No title here: the page header already names the view. This is the
          provenance line only — track count and which source it came from. */}
      <div className="pb-3">
        <p className="text-[13px] text-[var(--salt-mist)]">
          {isShowingPreviews && fullCount > 0
            ? `${fullCount} full-length match${fullCount === 1 ? '' : 'es'} + ${previewCount} preview — press any preview song and Marea will try to find a full recording.`
            : isShowingPreviews
              ? `${previewCount} preview ${previewCount === 1 ? 'track' : 'tracks'} — press any song and Marea will try to find a full recording.`
              : `${fullCount} ${fullCount === 1 ? 'track' : 'tracks'} — ${config.description}`}
        </p>
        {unavailableProviders.length > 0 && (
          <p className="mt-1 text-xs text-[var(--salt-mist)]">
            {unavailableProviders.join(', ')} {unavailableProviders.length === 1 ? 'is' : 'are'} unavailable. Showing
            available tracks.
          </p>
        )}
        {hasUnavailableTracks && (
          <p className="mt-1 text-xs text-[var(--danger)]">
            Some chart metadata is available, but its playback source is currently unavailable.
          </p>
        )}
      </div>
      <VirtualList
        items={displaySongs}
        estimateSize={56}
        label={`${config.title} tracks`}
        getItemKey={(song, index) => `${song.id}-${index}`}
        className="border-y border-[var(--glass-border)]"
        renderItem={(song, index) => (
          <SongCard song={song} index={index} tracks={displaySongs} onNavigateWithItem={onNavigateWithItem} />
        )}
      />
    </section>
  );
}

function TrackSkeleton() {
  return (
    <div className="pb-6">
      <div className="h-4 w-48 animate-pulse rounded bg-[var(--salt-ghost)]" />
      <div className="mt-3 grid">
        {Array.from({ length: 12 }).map((_, index) => (
          <div key={index} className="flex h-14 items-center gap-3 border-b border-[var(--glass-border)] px-1">
            <div className="hidden h-3 w-4 animate-pulse rounded bg-[var(--salt-ghost)] sm:block" />
            <div className="h-10 w-10 shrink-0 animate-pulse rounded bg-[var(--salt-ghost)]" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-3/5 animate-pulse rounded bg-[var(--salt-ghost)]" />
              <div className="h-2.5 w-2/5 animate-pulse rounded bg-[var(--salt-ghost)]" />
            </div>
            <div className="h-3 w-8 animate-pulse rounded bg-[var(--salt-ghost)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
