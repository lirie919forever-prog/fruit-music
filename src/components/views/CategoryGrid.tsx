'use client';

import { useQuery } from '@tanstack/react-query';
import { SongCard } from './SongCard';
import { StatusButton, StatusPanel } from '@/components/ui/StatusPanel';
import { providerErrorMessage } from '@/lib/providers/errors';
import { catalogStaleTime, countListResults } from '@/lib/catalogFreshness';
import type { NavigationItem } from '@/lib/navigation';
import type { FederatedResult } from '@/lib/api';
import type { Song, ViewType } from '@/types/music';

export interface CategoryConfig {
  view: ViewType;
  title: string;
  description: string;
  fetchFn: (signal?: AbortSignal) => Promise<Song[] | FederatedResult<Song>>;
  queryKey: string[];
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
  const {
    data: categoryState,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: config.queryKey,
    queryFn: ({ signal }) => config.fetchFn(signal),
    staleTime: catalogStaleTime(countListResults),
  });
  const {
    songs,
    failedProviders,
    degradedProviders,
    totalFailure: allProvidersFailed,
  } = getCategoryState(categoryState);
  const unavailableProviders = [...new Set([...failedProviders, ...degradedProviders])];
  const hasUnavailableTracks = songs.some((song) => song.playbackUnavailable);

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
  if (!songs?.length) {
    return (
      <StatusPanel
        eyebrow={config.title}
        title="No verified tracks are available for this category."
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
          {songs.length} {songs.length === 1 ? 'track' : 'tracks'} · {config.description}
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
      <div className="grid">
        {songs.map((song, index) => (
          <SongCard
            key={`${song.id}-${index}`}
            song={song}
            index={index}
            tracks={songs}
            onNavigateWithItem={onNavigateWithItem}
          />
        ))}
      </div>
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
