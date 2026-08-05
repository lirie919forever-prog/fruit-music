'use client';

import { Play, RefreshCw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SongRail } from './SongCard';
import { StatusButton, StatusPanel } from '@/components/ui/StatusPanel';
import { catalogStaleTime, countFederatedResults } from '@/lib/catalogFreshness';
import { useMusicCatalog } from '@/lib/musicCatalog';
import { providerErrorMessage } from '@/lib/providers/errors';
import { usePlayerStore } from '@/store/playerStore';
import type { NavigationItem } from '@/lib/navigation';
import type { Song, ViewType } from '@/types/music';

const EMPTY_STATIONS: Song[] = [];

function matchesStation(song: Song, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return `${song.title} ${song.artist} ${song.album} ${song.genre} ${song.provider}`
    .toLocaleLowerCase()
    .includes(needle);
}

export function RadioView({
  onNavigateWithItem,
}: {
  onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void;
}) {
  const catalog = useMusicCatalog();
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const [query, setQuery] = useState('');
  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['radio', 'stations'],
    queryFn: ({ signal }) => catalog.getLiveStations(64, signal),
    staleTime: catalogStaleTime(countFederatedResults),
    retry: 1,
  });

  const stations = data?.results ?? EMPTY_STATIONS;
  const visibleStations = useMemo(
    () => stations.filter((station) => matchesStation(station, query)),
    [stations, query],
  );
  const playableStations = visibleStations.filter((station) => station.playbackUnavailable !== true);
  const unavailableProviders = [...new Set([...(data?.failedProviders ?? []), ...(data?.degradedProviders ?? [])])];
  const availableNetworkCount = Math.max(0, (data?.providerCount ?? 0) - unavailableProviders.length);

  if (isPending) return <RadioSkeleton />;
  if (isError) {
    return (
      <StatusPanel
        eyebrow="Live radio unavailable"
        title={providerErrorMessage(error)}
        tone="error"
        actions={<StatusButton onClick={() => void refetch()}>Try again</StatusButton>}
      />
    );
  }

  return (
    <section className="pb-8">
      <div className="marea-glass-surface flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[13px] leading-relaxed text-[var(--salt-mist)]">
            {stations.length} live stations from {availableNetworkCount} radio networks.
          </p>
          {unavailableProviders.length > 0 && (
            <p className="mt-1 text-xs text-[var(--salt-mist)]">Unavailable: {unavailableProviders.join(', ')}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1 sm:w-56">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--salt-mist)]"
              aria-hidden
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a station"
              aria-label="Find a radio station"
              className="marea-glass-control h-9 w-full rounded-lg border pl-9 pr-3 text-[13px] text-[var(--salt-white)] outline-none focus:border-[var(--salt-primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--salt-primary)_20%,transparent)]"
            />
          </label>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="Refresh radio stations"
            title="Refresh radio stations"
            className="marea-glass-control flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-[var(--salt-mist)] hover:text-[var(--salt-primary)] disabled:cursor-wait disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => playableStations.length > 0 && playAlbum(playableStations, 0)}
            disabled={playableStations.length === 0}
            className="marea-primary-action inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
          >
            <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
            Play all
          </button>
        </div>
      </div>

      {visibleStations.length > 0 ? (
        <div className="pt-3">
          <SongRail songs={visibleStations} label="Live radio stations" onNavigateWithItem={onNavigateWithItem} />
        </div>
      ) : (
        <StatusPanel
          eyebrow="No stations found"
          title="Try a station name, country, genre, or radio network."
          tone="neutral"
        />
      )}
    </section>
  );
}

function RadioSkeleton() {
  return (
    <div className="pb-8">
      <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-4">
        <div className="h-4 w-64 animate-pulse rounded bg-[var(--salt-ghost)]" />
        <div className="h-9 w-36 animate-pulse rounded-lg bg-[var(--salt-ghost)]" />
      </div>
      <div className="mt-3 grid border-y border-[var(--glass-border)]">
        {Array.from({ length: 12 }).map((_, index) => (
          <div
            key={index}
            className="flex h-14 items-center gap-3 border-b border-[var(--glass-border)] px-1 last:border-b-0"
          >
            <div className="h-10 w-10 animate-pulse rounded bg-[var(--salt-ghost)]" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-2/5 animate-pulse rounded bg-[var(--salt-ghost)]" />
              <div className="h-2.5 w-1/4 animate-pulse rounded bg-[var(--salt-ghost)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
