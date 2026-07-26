'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { SongCard } from './SongCard';
import { StatusButton, StatusPanel } from '@/components/ui/StatusPanel';
import { providerErrorMessage } from '@/lib/providers/errors';
import type { NavigationItem } from '@/lib/navigation';
import type { Song, ViewType } from '@/types/music';

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [delay, value]);
  return debouncedValue;
}

function dedupeAndSort(songs: Song[], query: string): Song[] {
  const seen = new Set<string>();
  const unique = songs.filter((song) => {
    const key = `${song.title.toLowerCase()}|${song.artist.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const normalizedQuery = query.toLowerCase();
  return unique.sort((left, right) => {
    const score = (song: Song) => song.title.toLowerCase() === normalizedQuery ? 3 : song.title.toLowerCase().startsWith(normalizedQuery) ? 2 : song.artist.toLowerCase().includes(normalizedQuery) ? 1 : 0;
    return score(right) - score(left);
  });
}

export function SearchView({ query, onQueryChange, onNavigateWithItem }: { query: string; onQueryChange: (query: string) => void; onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void }) {
  const debouncedQuery = useDebounce(query, 300);
  const inputRef = useRef<HTMLInputElement>(null);
  const canSearch = debouncedQuery.trim().length >= 2;
  const lxEnabled = process.env.NEXT_PUBLIC_LX_ENABLED === 'true';

  useEffect(() => { inputRef.current?.focus(); }, []);

  const { data: searchState, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['search-federated', debouncedQuery],
    queryFn: async ({ signal }) => {
      const state = await api.search(debouncedQuery, signal);
      return { ...state, results: dedupeAndSort(state.results, debouncedQuery) };
    },
    enabled: canSearch,
    staleTime: 30_000,
  });

  const results = canSearch ? searchState?.results : undefined;
  const failedProviders = searchState?.failedProviders ?? [];
  const degradedProviders = searchState?.degradedProviders ?? [];
  const unavailableProviders = [...new Set([...failedProviders, ...degradedProviders])];
  const allProvidersFailed = searchState
    ? searchState.results.length === 0 && unavailableProviders.length === searchState.providerCount
    : false;

  return (
    <section className="space-y-4 pb-6">
      <div className="relative max-w-xl">
        <label htmlFor="music-search" className="sr-only">Search music</label>
        <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--pearl-dim)]"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
        <input id="music-search" ref={inputRef} type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search music…" className="h-10 w-full rounded-lg border border-[var(--glass-border)] bg-white pl-10 pr-4 text-[13px] text-[var(--pearl-bright)] outline-none transition-[border-color,box-shadow] focus:border-[var(--biolum-primary)] focus:ring-2 focus:ring-[var(--biolum-glow)]" />
      </div>

      {!canSearch && <p className="py-12 text-center text-[13px] text-[var(--pearl-dim)]">{debouncedQuery ? 'Type at least 2 characters to search' : lxEnabled ? 'Search across Jamendo, ccMixter, Archive, and LX Music tracks' : 'Search across verified Jamendo, ccMixter, and Archive tracks'}</p>}
      {isLoading && <SearchSkeleton />}
      {(isError || (results && allProvidersFailed && !isLoading)) && (
        <StatusPanel
          eyebrow="Search unavailable"
          title={isError ? providerErrorMessage(error) : 'Search providers are unavailable. Please try again.'}
          tone="error"
          align="center"
          actions={<StatusButton onClick={() => void refetch()}>Try again</StatusButton>}
        />
      )}
      {results && unavailableProviders.length > 0 && !allProvidersFailed && <p className="text-xs text-[var(--pearl-dim)]">{unavailableProviders.join(', ')} {unavailableProviders.length === 1 ? 'was' : 'were'} unavailable or degraded. Showing available results.</p>}
      {results && !results.length && !allProvidersFailed && !isLoading && <p className="py-12 text-center text-[13px] text-[var(--pearl-dim)]">No tracks match “{debouncedQuery}”.</p>}
      {results && results.length > 0 && (
        <div>
          <h2 className="mb-1 text-[17px] font-bold tracking-[-0.01em] text-[var(--salt-white)]">Tracks <span className="font-normal text-[var(--salt-mist)]">· {results.length}</span></h2>
          <div className="grid">
            {results.map((song, index) => (
              <SongCard key={song.id} song={song} index={index} tracks={results} showIndex={false} onNavigateWithItem={onNavigateWithItem} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SearchSkeleton() {
  return <div className="grid">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="flex h-14 items-center gap-3 border-b border-[var(--glass-border)] px-1"><div className="h-10 w-10 shrink-0 animate-pulse rounded bg-[var(--salt-ghost)]" /><div className="min-w-0 flex-1 space-y-2"><div className="h-3 w-1/2 animate-pulse rounded bg-[var(--salt-ghost)]" /><div className="h-2.5 w-1/3 animate-pulse rounded bg-[var(--salt-ghost)]" /></div></div>)}</div>;
}
