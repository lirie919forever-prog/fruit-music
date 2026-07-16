'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { usePlayerStore } from '@/store/playerStore';
import { Attribution } from '@/components/ui/Attribution';
import { providerErrorMessage } from '@/lib/providers/errors';
import type { Song } from '@/types/music';

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

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function SearchView() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const inputRef = useRef<HTMLInputElement>(null);
  const canSearch = debouncedQuery.trim().length >= 2;

  useEffect(() => { inputRef.current?.focus(); }, []);

  const { data: searchState, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['search-federated', debouncedQuery],
    queryFn: async () => {
      const state = await api.search(debouncedQuery);
      return { ...state, results: dedupeAndSort(state.results, debouncedQuery) };
    },
    enabled: canSearch,
    staleTime: 30_000,
  });

  const results = canSearch ? searchState?.results : undefined;
  const failedProviders = searchState?.failedProviders ?? [];
  const allProvidersFailed = failedProviders.length === (searchState?.providerCount ?? 3);

  return (
    <section className="space-y-6 pb-[120px]">
      <div className="relative max-w-xl">
        <label htmlFor="music-search" className="sr-only">Search verified music</label>
        <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--pearl-dim)]"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
        <input id="music-search" ref={inputRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search verified music…" className="h-12 w-full rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] pl-12 pr-4 text-sm text-[var(--pearl-bright)] outline-none transition focus:border-[var(--biolum-primary)] focus:ring-2 focus:ring-[var(--biolum-glow)]" />
      </div>

      {!canSearch && <p className="py-12 text-center text-sm text-[var(--pearl-dim)]">{debouncedQuery ? 'Type at least 2 characters to search' : 'Search across verified Jamendo, ccMixter, and Archive tracks'}</p>}
      {isLoading && <SearchSkeleton />}
      {isError && <div className="flex flex-col items-center gap-3 py-10 text-[var(--danger)]"><p>{providerErrorMessage(error)}</p><button type="button" onClick={() => void refetch()} className="rounded-full border border-[var(--glass-border-active)] px-4 py-2 text-sm text-[var(--salt-white)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]">Try again</button></div>}
      {results && allProvidersFailed && !isLoading && <p className="py-10 text-center text-sm text-[var(--danger)]">Search providers are unavailable. Please try again.</p>}
      {results && failedProviders.length > 0 && !allProvidersFailed && <p className="text-xs text-[var(--pearl-dim)]">{failedProviders.join(', ')} {failedProviders.length === 1 ? 'was' : 'were'} unavailable. Showing available results.</p>}
      {results && !results.length && !allProvidersFailed && !isLoading && <p className="py-12 text-center text-sm text-[var(--pearl-dim)]">No verified tracks match “{debouncedQuery}”.</p>}
      {results && results.length > 0 && <div className="space-y-1"><p className="mb-2 text-xs uppercase tracking-widest text-[var(--pearl-dim)]">Tracks — {results.length} results</p>{results.map((song) => <SearchResultRow key={song.id} song={song} />)}</div>}
    </section>
  );
}

function SearchResultRow({ song }: { song: Song }) {
  const playSong = usePlayerStore((state) => state.playSong);
  const addToQueue = usePlayerStore((state) => state.addToQueue);
  const currentSong = usePlayerStore((state) => state.currentSong);
  const isActive = currentSong?.id === song.id;

  return (
    <article className={`grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border-l-2 px-3 py-2 ${isActive ? 'border-[var(--biolum-primary)] bg-[var(--glass-hover)]' : 'border-transparent'}`}>
      <img src={song.coverArt} alt={song.album} loading="lazy" decoding="async" className="h-10 w-10 rounded-md object-cover" />
      <div className="min-w-0"><p className="truncate text-sm font-medium text-[var(--pearl-bright)]">{song.title}</p><p className="truncate text-xs text-[var(--pearl-dim)]">{song.artist}</p><div className="mt-1"><Attribution song={song} compact /></div></div>
      <div className="flex items-center gap-1"><span className="hidden text-xs tabular-nums text-[var(--pearl-dim)] sm:inline">{formatDuration(song.duration)}</span><button type="button" onClick={() => addToQueue(song)} aria-label={`Add ${song.title} to queue`} className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--glass-border)] text-[var(--salt-bright)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]">＋</button><button type="button" onClick={() => playSong(song)} aria-label={`Play ${song.title} by ${song.artist}`} className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--salt-primary)] text-[var(--sea-abyss)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-white)]">▶</button></div>
    </article>
  );
}

function SearchSkeleton() {
  return <div className="space-y-1">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-lg bg-[var(--salt-ghost)]" />)}</div>;
}
