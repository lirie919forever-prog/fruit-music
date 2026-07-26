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
    <section className="pb-[120px]">
      <div className="px-4 pb-3 pt-5 sm:px-6">
        {unavailableProviders.length > 0 && <p className="mb-2 text-xs text-[var(--salt-mist)]">{unavailableProviders.join(', ')} {unavailableProviders.length === 1 ? 'is' : 'are'} unavailable. Showing available tracks.</p>}
        {hasUnavailableTracks && <p className="mb-2 text-xs text-[var(--danger)]">Some chart metadata is available, but its playback source is currently unavailable.</p>}
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-[28px] font-semibold italic text-[var(--salt-white)]" style={{ fontFamily: 'var(--font-display)' }}>{config.title}</h2>
          <span className="rounded-full border border-[var(--glass-border)] bg-[var(--salt-ghost)] px-2.5 py-0.5 text-[11px] text-[var(--salt-mist)]">{songs.length} tracks</span>
        </div>
        <p className="mt-1 text-xs text-[var(--salt-mist)]">{config.description}</p>
      </div>
      <div className="space-y-1">
        {songs.map((song, index) => (
          <SongCard key={`${song.id}-${index}`} song={song} index={index} tracks={songs} onNavigateWithItem={onNavigateWithItem} />
        ))}
      </div>
    </section>
  );
}

function TrackSkeleton() {
  return (
    <div className="space-y-1 pb-[120px] pt-5">
      <div className="mx-4 h-8 w-32 animate-pulse rounded bg-[var(--salt-ghost)] sm:mx-6" />
      {Array.from({ length: 12 }).map((_, index) => (
        <div key={index} className="grid grid-cols-[40px_minmax(0,1fr)_76px] items-center gap-2 px-3 py-2 sm:grid-cols-[36px_48px_minmax(0,1fr)_56px_76px] sm:px-6">
          <div className="hidden h-4 w-5 animate-pulse rounded bg-[var(--salt-ghost)] sm:block" />
          <div className="h-10 w-10 animate-pulse rounded-md bg-[var(--salt-ghost)]" />
          <div className="space-y-2"><div className="h-3 w-3/5 animate-pulse rounded bg-[var(--salt-ghost)]" /><div className="h-2.5 w-2/5 animate-pulse rounded bg-[var(--salt-ghost)]" /></div>
          <div className="h-8 w-[72px] animate-pulse rounded bg-[var(--salt-ghost)]" />
        </div>
      ))}
    </div>
  );
}
