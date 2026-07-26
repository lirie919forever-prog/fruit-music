'use client';

import { useQuery } from '@tanstack/react-query';
import { SongCard } from './SongCard';
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
    totalFailure:
      data.results.length === 0 &&
      unavailableProviders.length === data.providerCount,
  };
}

export function CategoryGrid({ config, onNavigateWithItem }: { config: CategoryConfig; onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void }) {
  const { data: categoryState, isLoading, isError, error, refetch } = useQuery({
    queryKey: config.queryKey,
    queryFn: ({ signal }) => config.fetchFn(signal),
    staleTime: catalogStaleTime(countListResults),
  });
  const { songs, failedProviders, degradedProviders, totalFailure: allProvidersFailed } = getCategoryState(categoryState);
  const unavailableProviders = [...new Set([...failedProviders, ...degradedProviders])];
  const hasUnavailableTracks = songs.some((song) => song.playbackUnavailable);

  if (isLoading) return <TrackSkeleton />;
  if (isError) {
    return (
      <div className="flex flex-col items-start gap-3 px-4 py-10 text-[var(--salt-mist)] sm:px-6">
        <p>{providerErrorMessage(error)}</p>
        <button type="button" onClick={() => void refetch()} className="rounded-full border border-[var(--glass-border-active)] bg-white/70 px-4 py-2 text-sm text-[var(--salt-primary)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]">Try again</button>
      </div>
    );
  }
  if (allProvidersFailed) {
    return (
      <div className="flex flex-col items-start gap-3 px-4 py-10 text-[var(--salt-mist)] sm:px-6">
        <p>Category providers are unavailable. Please try again.</p>
        <button type="button" onClick={() => void refetch()} className="rounded-full border border-[var(--glass-border-active)] bg-white/70 px-4 py-2 text-sm text-[var(--salt-primary)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]">Try again</button>
      </div>
    );
  }
  if (!songs?.length) {
    return <div className="mx-4 my-8 rounded-[24px] border border-[var(--glass-border)] bg-white/45 px-5 py-8 text-[var(--salt-mist)] sm:mx-6"><p>No verified tracks are available for this category.</p>{unavailableProviders.length > 0 && <p className="mt-2 text-xs">Unavailable or degraded: {unavailableProviders.join(', ')}</p>}<button type="button" onClick={() => void refetch()} className="mt-4 rounded-full border border-[var(--glass-border-active)] bg-white/70 px-4 py-2 text-sm text-[var(--salt-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]">Refresh</button></div>;
  }

  return (
    <section className="pb-6">
      {/* No title here: the page header already names the view. This is the
          provenance line only — track count and which source it came from. */}
      <div className="pb-3">
        <p className="text-[13px] text-[var(--salt-mist)]">
          {songs.length} {songs.length === 1 ? 'track' : 'tracks'} · {config.description}
        </p>
        {unavailableProviders.length > 0 && <p className="mt-1 text-xs text-[var(--salt-mist)]">{unavailableProviders.join(', ')} {unavailableProviders.length === 1 ? 'is' : 'are'} unavailable. Showing available tracks.</p>}
        {hasUnavailableTracks && <p className="mt-1 text-xs text-[var(--danger)]">Some chart metadata is available, but its playback source is currently unavailable.</p>}
      </div>
      <div className="grid">
        {songs.map((song, index) => (
          <SongCard key={`${song.id}-${index}`} song={song} index={index} tracks={songs} onNavigateWithItem={onNavigateWithItem} />
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
            <div className="min-w-0 flex-1 space-y-2"><div className="h-3 w-3/5 animate-pulse rounded bg-[var(--salt-ghost)]" /><div className="h-2.5 w-2/5 animate-pulse rounded bg-[var(--salt-ghost)]" /></div>
            <div className="h-3 w-8 animate-pulse rounded bg-[var(--salt-ghost)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
