'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { SongCard } from './SongCard';
import { AlbumTile, ArtistTile, TILE_GRID } from '@/components/ui/CatalogTile';
import { StatusButton, StatusPanel } from '@/components/ui/StatusPanel';
import { providerErrorMessage } from '@/lib/providers/errors';
import type { AudioAccessMode } from './newViewModel';
import { areAllSearchProvidersUnavailable, rankSearchSongsForAccess, splitTopSearchMatches } from './searchViewModel';
import type { NavigationItem } from '@/lib/navigation';
import type { ViewType } from '@/types/music';

// Two rows of tiles at the widest breakpoint. Search is a way through to the
// tracks, so the artist and album sections stay a glance rather than a page the
// track results have to be scrolled past.
const ARTIST_LIMIT = 12;
const ALBUM_LIMIT = 12;

/** Named so the empty state promises exactly what the federation actually queries. */
const SEARCH_SOURCES = [
  'Apple Music',
  'Deezer',
  'Audius',
  'Wikimedia Commons',
  'Jamendo',
  'ccMixter',
  'Archive',
  'Openverse',
  'SomaFM',
  'Radio Browser',
];
const AUDIO_ACCESS_OPTIONS: Array<{ mode: AudioAccessMode; label: string }> = [
  { mode: 'full', label: 'Full tracks' },
  { mode: 'all', label: 'All audio' },
  { mode: 'preview', label: 'Previews' },
];

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
  const [accessMode, setAccessMode] = useState<AudioAccessMode>('full');

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
    queryFn: ({ signal }) => api.search(debouncedQuery, signal),
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

  const artists = useMemo(
    () => (canSearch ? (artistState?.results ?? []).slice(0, ARTIST_LIMIT) : []),
    [artistState?.results, canSearch],
  );
  const albums = useMemo(
    () => (canSearch ? (albumState?.results ?? []).slice(0, ALBUM_LIMIT) : []),
    [albumState?.results, canSearch],
  );
  const rawResults = canSearch ? searchState?.results : undefined;
  const results = useMemo(
    () => (rawResults ? rankSearchSongsForAccess(rawResults, debouncedQuery, accessMode) : undefined),
    [accessMode, debouncedQuery, rawResults],
  );
  const { topMatches, remainingTracks } = useMemo(() => splitTopSearchMatches(results ?? []), [results]);
  const allProvidersFailed = searchState ? areAllSearchProvidersUnavailable(searchState) : false;

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

      <div
        className="grid w-full max-w-xl grid-cols-3 gap-1 rounded-lg bg-[var(--salt-ghost)] p-1 sm:w-auto sm:min-w-[300px]"
        role="radiogroup"
        aria-label="Filter search results by playback access"
      >
        {AUDIO_ACCESS_OPTIONS.map((option) => {
          const selected = option.mode === accessMode;
          return (
            <button
              key={option.mode}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setAccessMode(option.mode)}
              className={`h-8 min-w-0 rounded-md px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] ${selected ? 'bg-white text-[var(--salt-white)] shadow-sm' : 'text-[var(--salt-mist)] hover:text-[var(--salt-white)]'}`}
            >
              <span className="block truncate">{option.label}</span>
            </button>
          );
        })}
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
      {results && !results.length && !artists.length && !albums.length && !allProvidersFailed && !isLoading && (
        <p className="py-12 text-center text-[13px] text-[var(--pearl-dim)]">
          {rawResults?.length && accessMode === 'full'
            ? 'No full tracks match this search.'
            : `Nothing matches "${debouncedQuery}"`}
        </p>
      )}

      {topMatches.length > 0 && results && (
        <ResultSection title="Top results" count={topMatches.length}>
          <div className="grid">
            {topMatches.map((song, index) => (
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
        </ResultSection>
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

      {remainingTracks.length > 0 && results && (
        <ResultSection title="More tracks" count={remainingTracks.length}>
          <div className="grid">
            {remainingTracks.map((song, index) => (
              <SongCard
                key={song.id}
                song={song}
                index={topMatches.length + index}
                tracks={results}
                showIndex={false}
                onNavigateWithItem={onNavigateWithItem}
              />
            ))}
          </div>
        </ResultSection>
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
