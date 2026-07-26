'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { SongCard } from './SongCard';
import { AlbumTile, ArtistTile, TILE_GRID } from '@/components/ui/CatalogTile';
import { StatusButton, StatusPanel } from '@/components/ui/StatusPanel';
import { providerErrorMessage } from '@/lib/providers/errors';
import type { NavigationItem } from '@/lib/navigation';
import type { Song, ViewType } from '@/types/music';

// Two rows of tiles at the widest breakpoint. Search is a way through to the
// tracks, so the artist and album sections stay a glance rather than a page the
// track results have to be scrolled past.
const ARTIST_LIMIT = 12;
const ALBUM_LIMIT = 12;

/** Named so the empty state promises exactly what the federation actually queries. */
const SEARCH_SOURCES = ['Apple', 'Jamendo', 'ccMixter', 'Archive'];

function ResultSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-[17px] font-bold tracking-[-0.01em] text-[var(--salt-white)]">
        {title} <span className="font-normal text-[var(--salt-mist)]">· {count}</span>
      </h2>
      {children}
    </div>
  );
}

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
    const score = (song: Song) =>
      song.title.toLowerCase() === normalizedQuery
        ? 3
        : song.title.toLowerCase().startsWith(normalizedQuery)
          ? 2
          : song.artist.toLowerCase().includes(normalizedQuery)
            ? 1
            : 0;
    return score(right) - score(left);
  });
}

export function SearchView({
  query,
  onQueryChange,
  onNavigateWithItem,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void;
}) {
  const debouncedQuery = useDebounce(query, 300);
  const inputRef = useRef<HTMLInputElement>(null);
  const canSearch = debouncedQuery.trim().length >= 2;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const {
    data: searchState,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['search-federated', debouncedQuery],
    queryFn: async ({ signal }) => {
      const state = await api.search(debouncedQuery, signal);
      return { ...state, results: dedupeAndSort(state.results, debouncedQuery) };
    },
    enabled: canSearch,
    staleTime: 30_000,
  });

  // Artists and albums load beside the tracks rather than behind a tab, so a
  // search for a performer answers with the performer instead of making you
  // recognise them from a track list. Each is its own query: a slow album index
  // must not hold back the track results, which are what most searches want.
  const { data: artistState } = useQuery({
    queryKey: ['search-artists', debouncedQuery],
    queryFn: ({ signal }) => api.searchArtists(debouncedQuery, signal),
    enabled: canSearch,
    staleTime: 30_000,
  });
  const { data: albumState } = useQuery({
    queryKey: ['search-albums', debouncedQuery],
    queryFn: ({ signal }) => api.searchAlbums(debouncedQuery, signal),
    enabled: canSearch,
    staleTime: 30_000,
  });

  const artists = canSearch ? (artistState?.results ?? []).slice(0, ARTIST_LIMIT) : [];
  const albums = canSearch ? (albumState?.results ?? []).slice(0, ALBUM_LIMIT) : [];
  const results = canSearch ? searchState?.results : undefined;
  const failedProviders = searchState?.failedProviders ?? [];
  const degradedProviders = searchState?.degradedProviders ?? [];
  const unavailableProviders = [...new Set([...failedProviders, ...degradedProviders])];
  const allProvidersFailed = searchState
    ? searchState.results.length === 0 && unavailableProviders.length === searchState.providerCount
    : false;

  return (
    <section className="space-y-6 pb-6">
      <div className="relative max-w-xl">
        <label htmlFor="music-search" className="sr-only">
          Search music
        </label>
        <svg
          aria-hidden
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--pearl-dim)]"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          id="music-search"
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search music…"
          className="h-10 w-full rounded-lg border border-[var(--glass-border)] bg-white pl-10 pr-4 text-[13px] text-[var(--pearl-bright)] outline-none transition-[border-color,box-shadow] focus:border-[var(--biolum-primary)] focus:ring-2 focus:ring-[var(--biolum-glow)]"
        />
      </div>

      {!canSearch && (
        <p className="py-12 text-center text-[13px] text-[var(--pearl-dim)]">
          {debouncedQuery
            ? 'Type at least 2 characters to search'
            : `Search artists, albums and tracks across ${SEARCH_SOURCES.join(', ')}`}
        </p>
      )}
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
      {results && unavailableProviders.length > 0 && !allProvidersFailed && (
        <p className="text-xs text-[var(--pearl-dim)]">
          {unavailableProviders.join(', ')} {unavailableProviders.length === 1 ? 'was' : 'were'} unavailable or
          degraded. Showing available results.
        </p>
      )}
      {results && !results.length && !artists.length && !albums.length && !allProvidersFailed && !isLoading && (
        <p className="py-12 text-center text-[13px] text-[var(--pearl-dim)]">Nothing matches “{debouncedQuery}”.</p>
      )}

      {artists.length > 0 && (
        <ResultSection title="Artists" count={artists.length}>
          <div className={TILE_GRID}>
            {artists.map((artist) => (
              <ArtistTile key={artist.id} artist={artist} onNavigateWithItem={onNavigateWithItem} />
            ))}
          </div>
        </ResultSection>
      )}

      {albums.length > 0 && (
        <ResultSection title="Albums" count={albums.length}>
          <div className={TILE_GRID}>
            {albums.map((album) => (
              <AlbumTile key={album.id} album={album} onNavigateWithItem={onNavigateWithItem} />
            ))}
          </div>
        </ResultSection>
      )}

      {results && results.length > 0 && (
        <div>
          <h2 className="mb-1 text-[17px] font-bold tracking-[-0.01em] text-[var(--salt-white)]">
            Tracks <span className="font-normal text-[var(--salt-mist)]">· {results.length}</span>
          </h2>
          <div className="grid">
            {results.map((song, index) => (
              <SongCard
                key={song.id}
                song={song}
                index={index}
                tracks={results}
                showIndex={false}
                onNavigateWithItem={onNavigateWithItem}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SearchSkeleton() {
  return (
    <div className="grid">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="flex h-14 items-center gap-3 border-b border-[var(--glass-border)] px-1">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded bg-[var(--salt-ghost)]" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--salt-ghost)]" />
            <div className="h-2.5 w-1/3 animate-pulse rounded bg-[var(--salt-ghost)]" />
          </div>
        </div>
      ))}
    </div>
  );
}
