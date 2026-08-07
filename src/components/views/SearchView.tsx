'use client';

import { AlertTriangle, BarChart3, ChevronRight, Clock, Globe, Play, Search, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SongCard } from './SongCard';
import { AudioAccessControl } from './AudioAccessControl';
import { AlbumTile, ArtistTile, TILE_GRID } from '@/components/ui/CatalogTile';
import { StatusButton, StatusPanel } from '@/components/ui/StatusPanel';
import { providerErrorMessage } from '@/lib/providers/errors';
import type { AudioAccessMode } from './newViewModel';
import {
  areAllSearchProvidersUnavailable,
  rankSearchAlbums,
  rankSearchArtists,
  rankSearchSongsForAccess,
  splitTopSearchMatches,
  summarizeSearchProviders,
  type SearchProviderSummary,
} from './searchViewModel';
import type { NavigationItem } from '@/lib/navigation';
import type { ViewType } from '@/types/music';
import { usePlayerStore } from '@/store/playerStore';
import { getSearchSourceNames } from '@/lib/sourceRegistry';
import { playableSongs } from './newViewModel';
import { VirtualList } from '@/components/ui/VirtualList';
import { useMusicCatalog } from '@/lib/musicCatalog';

// Two rows of tiles at the widest breakpoint. Search is a way through to the
// tracks, so the artist and album sections stay a glance rather than a page the
// track results have to be scrolled past.
const ARTIST_LIMIT = 12;
const ALBUM_LIMIT = 12;

const SEARCH_LANES: Array<{ label: string; detail: string; query: string; icon: ReactNode }> = [
  { label: 'Chart watch', detail: 'Fresh chart signals', query: 'top songs', icon: <BarChart3 /> },
  { label: 'New releases', detail: 'Recently added music', query: 'new music', icon: <Sparkles /> },
  { label: 'Open catalog', detail: 'Full-length listening', query: 'creative commons', icon: <Globe /> },
];

const SEARCH_SUGGESTIONS = ['Taylor Swift', 'J-pop', 'Lo-fi', 'Jazz', 'Classical', 'Ambient'];

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

function SearchLanding({
  recentSearches,
  searchSources,
  onSearch,
  onClearRecent,
}: {
  recentSearches: string[];
  searchSources: string[];
  onSearch: (query: string) => void;
  onClearRecent: () => void;
}) {
  return (
    <div className="space-y-8 py-4 sm:py-6">
      {recentSearches.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-[17px] font-bold text-[var(--salt-white)]">
              <Clock className="h-4 w-4 text-[var(--salt-primary)]" aria-hidden />
              Recent searches
            </h2>
            <button
              type="button"
              onClick={onClearRecent}
              className="text-xs font-semibold text-[var(--salt-mist)] underline-offset-2 hover:text-[var(--salt-primary)] hover:underline"
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {recentSearches.map((recent) => (
              <button
                key={recent}
                type="button"
                onClick={() => onSearch(recent)}
                className="marea-glass-control inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold text-[var(--salt-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
              >
                <Clock className="h-3.5 w-3.5" aria-hidden />
                {recent}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="text-[17px] font-bold text-[var(--salt-white)]">Explore the catalog</h2>
          <span className="text-xs text-[var(--salt-mist)]">{searchSources.length} sources</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SEARCH_LANES.map((lane) => (
            <button
              key={lane.label}
              type="button"
              onClick={() => onSearch(lane.query)}
              className="marea-glass-card group flex min-h-[86px] items-center gap-3 rounded-xl border px-3.5 text-left transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--salt-ghost)] text-[var(--salt-primary)]">
                {lane.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-[var(--salt-white)]">{lane.label}</span>
                <span className="mt-0.5 block truncate text-xs text-[var(--salt-mist)]">{lane.detail}</span>
              </span>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-[var(--salt-mist)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--salt-primary)]"
                aria-hidden
              />
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-[var(--glass-border)] pt-5">
        <h2 className="mb-3 text-[13px] font-semibold text-[var(--salt-white)]">Start with a popular search</h2>
        <div className="flex flex-wrap gap-2">
          {SEARCH_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onSearch(suggestion)}
              className="min-h-8 rounded-full border border-[var(--glass-border)] px-3 text-xs font-semibold text-[var(--salt-foam)] transition-colors hover:border-[var(--glass-border-active)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-[var(--glass-border)] pt-5">
        <h2 className="mb-3 text-[13px] font-semibold text-[var(--salt-white)]">Search across sources</h2>
        <div className="flex flex-wrap gap-1.5">
          {searchSources.map((source) => (
            <span
              key={source}
              className="inline-flex min-h-7 items-center rounded-full bg-[var(--salt-ghost)] px-2.5 text-[11px] font-medium text-[var(--salt-mist)]"
            >
              {source}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SearchSourceCoverage({ summaries }: { summaries: SearchProviderSummary[] }) {
  if (summaries.length === 0) return null;
  const responding = summaries.filter((summary) => summary.status !== 'unavailable').length;
  const statusLabel = (summary: SearchProviderSummary): string => {
    if (summary.status === 'unavailable') return 'Unavailable';
    if (summary.status === 'partial') return 'Partial';
    if (summary.status === 'no-match') return 'No match';
    return `${summary.resultCount} result${summary.resultCount === 1 ? '' : 's'}`;
  };
  const statusClass = (summary: SearchProviderSummary): string => {
    if (summary.status === 'unavailable') return 'border-[#f1d4d5] bg-[#fff6f6] text-[#a0464d]';
    if (summary.status === 'partial') return 'border-[#f0dfc1] bg-[#fffaf0] text-[#95631f]';
    if (summary.status === 'no-match')
      return 'border-[var(--glass-border)] bg-[var(--salt-ghost)] text-[var(--salt-mist)]';
    return 'border-[#cfe9d9] bg-[#f4fbf6] text-[#28764a]';
  };

  return (
    <div className="border-t border-[var(--glass-border)] pt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className="font-semibold text-[var(--salt-white)]">Source coverage</span>
        <span className="text-[var(--salt-mist)]">
          {responding}/{summaries.length} responding
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="list" aria-label="Search source coverage">
        {summaries.map((summary) => (
          <span
            key={summary.name}
            role="listitem"
            title={`${summary.name}: ${statusLabel(summary)}`}
            className={`inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-semibold ${statusClass(summary)}`}
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
            <span>{summary.name}</span>
            <span className="font-normal opacity-80">{statusLabel(summary)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function SearchView({
  query,
  sourceFilter = 'all',
  onQueryChange,
  onNavigateWithItem,
  onSourceFilterChange,
}: {
  query: string;
  sourceFilter?: string;
  onQueryChange: (query: string) => void;
  onSourceFilterChange?: (source: string) => void;
  onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void;
}) {
  const catalog = useMusicCatalog();
  const debouncedQuery = useDebounce(query, 300);
  const inputRef = useRef<HTMLInputElement>(null);
  const recentSearches = usePlayerStore((state) => state.recentSearches);
  const recordSearch = usePlayerStore((state) => state.recordSearch);
  const clearRecentSearches = usePlayerStore((state) => state.clearRecentSearches);
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const canSearch = debouncedQuery.trim().length >= 2;
  const [accessMode, setAccessMode] = useState<AudioAccessMode>('full');
  const searchSources = useMemo(() => getSearchSourceNames(process.env.NEXT_PUBLIC_LX_ENABLED === 'true'), []);
  const requestedSource = sourceFilter !== 'all' && searchSources.includes(sourceFilter) ? sourceFilter : 'all';

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (canSearch) recordSearch(debouncedQuery);
  }, [canSearch, debouncedQuery, recordSearch]);

  const {
    data: searchState,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['search-federated', debouncedQuery, requestedSource],
    queryFn: ({ signal }) => catalog.search(debouncedQuery, signal, requestedSource),
    enabled: canSearch,
    staleTime: 30_000,
  });

  // Artists and albums load beside the tracks rather than behind a tab, so a
  // search for a performer answers with the performer instead of making you
  // recognise them from a track list. Each is its own query: a slow album index
  // must not hold back the track results, which are what most searches want.
  const { data: artistState } = useQuery({
    queryKey: ['search-artists', debouncedQuery, requestedSource],
    queryFn: ({ signal }) => catalog.searchArtists(debouncedQuery, signal, requestedSource),
    enabled: canSearch,
    staleTime: 30_000,
  });
  const { data: albumState } = useQuery({
    queryKey: ['search-albums', debouncedQuery, requestedSource],
    queryFn: ({ signal }) => catalog.searchAlbums(debouncedQuery, signal, requestedSource),
    enabled: canSearch,
    staleTime: 30_000,
  });

  const artists = useMemo(
    () => (canSearch ? rankSearchArtists(artistState?.results ?? [], debouncedQuery).slice(0, ARTIST_LIMIT) : []),
    [artistState?.results, canSearch, debouncedQuery],
  );
  const albums = useMemo(
    () => (canSearch ? rankSearchAlbums(albumState?.results ?? [], debouncedQuery).slice(0, ALBUM_LIMIT) : []),
    [albumState?.results, canSearch, debouncedQuery],
  );
  const rawResults = canSearch ? searchState?.results : undefined;
  const sourceOptions = useMemo(() => {
    return [...new Set([...searchSources, ...(rawResults ?? []).map((song) => song.provider)])].sort((left, right) =>
      left.localeCompare(right),
    );
  }, [rawResults, searchSources]);
  const activeSourceFilter = requestedSource;
  const sourceFilteredResults = useMemo(
    () => rawResults?.filter((song) => activeSourceFilter === 'all' || song.provider === activeSourceFilter) ?? [],
    [activeSourceFilter, rawResults],
  );
  const results = useMemo(
    () => (rawResults ? rankSearchSongsForAccess(sourceFilteredResults, debouncedQuery, accessMode) : undefined),
    [accessMode, debouncedQuery, rawResults, sourceFilteredResults],
  );
  const { topMatches, remainingTracks } = useMemo(() => splitTopSearchMatches(results ?? []), [results]);
  const allProvidersFailed = searchState ? areAllSearchProvidersUnavailable(searchState) : false;
  const playableResults = useMemo(() => playableSongs(results ?? []), [results]);
  const sourceCount = useMemo(() => new Set((results ?? []).map((song) => song.provider)).size, [results]);
  const sourceCoverage = useMemo(
    () =>
      searchState
        ? summarizeSearchProviders(
            requestedSource === 'all' ? searchSources : [requestedSource],
            results ?? [],
            searchState.failedProviders,
            searchState.degradedProviders,
          )
        : [],
    [requestedSource, results, searchSources, searchState],
  );
  const unavailableProviders = useMemo(
    () => [...new Set([...(searchState?.failedProviders ?? []), ...(searchState?.degradedProviders ?? [])])],
    [searchState?.degradedProviders, searchState?.failedProviders],
  );
  return (
    <section className="space-y-6 pb-6">
      <div className="relative max-w-xl">
        <label htmlFor="music-search" className="sr-only">
          Search music
        </label>
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pearl-dim)]"
        />
        <input
          id="music-search"
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search music…"
          className="marea-glass-control h-10 w-full rounded-lg border pl-10 pr-4 text-[13px] text-[var(--pearl-bright)] outline-none focus:border-[var(--biolum-primary)] focus:ring-2 focus:ring-[var(--biolum-glow)]"
        />
      </div>

      <AudioAccessControl mode={accessMode} onChange={setAccessMode} label="Filter search results by playback access" />

      {searchSources.length > 0 && (
        <label className="flex w-full max-w-xl items-center gap-2 text-xs font-semibold text-[var(--salt-mist)] sm:w-auto">
          <span className="shrink-0">Source</span>
          <select
            aria-label="Filter search results by source"
            value={activeSourceFilter}
            onChange={(event) => onSourceFilterChange?.(event.target.value)}
            className="marea-glass-control h-9 min-w-0 flex-1 rounded-lg border px-2.5 text-xs font-semibold text-[var(--salt-white)] outline-none focus:border-[var(--glass-border-active)] focus:ring-2 focus:ring-[var(--salt-primary)]/15 sm:w-[220px] sm:flex-none"
          >
            <option value="all">All sources ({sourceOptions.length})</option>
            {sourceOptions.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </label>
      )}

      {!canSearch && debouncedQuery && (
        <p className="py-8 text-center text-[13px] text-[var(--pearl-dim)]">Type at least 2 characters to search</p>
      )}
      {!canSearch && !debouncedQuery && (
        <SearchLanding
          recentSearches={recentSearches}
          searchSources={searchSources}
          onSearch={onQueryChange}
          onClearRecent={clearRecentSearches}
        />
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

      {results && searchState && results.length > 0 && (
        <div className="marea-glass-surface space-y-2 rounded-xl border px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--salt-mist)]">
              <span className="font-semibold text-[var(--salt-white)]">
                {results.length}{' '}
                {accessMode === 'full'
                  ? 'full-track candidates'
                  : accessMode === 'preview'
                    ? 'preview clips'
                    : 'audio results'}
              </span>
              <span className="px-1 text-[var(--pearl-whisper)]" aria-hidden>
                |
              </span>
              <span>{sourceCount} sources returned matches</span>
              <span className="px-1 text-[var(--pearl-whisper)]" aria-hidden>
                |
              </span>
              <span>
                {Math.max(0, searchState.providerCount - searchState.failedProviders.length)}/
                {searchState.providerCount} sources responding
              </span>
            </div>
            <button
              type="button"
              onClick={() => playAlbum(playableResults, 0)}
              disabled={playableResults.length === 0}
              className="marea-primary-action inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold text-white disabled:cursor-not-allowed"
            >
              <Play className="h-3.5 w-3.5" aria-hidden />
              Play all ({playableResults.length})
            </button>
          </div>
          {unavailableProviders.length > 0 && (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-[#8a5b19]" role="status">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                Unavailable or partial right now: {unavailableProviders.join(', ')}. Healthy results remain visible.
              </span>
            </p>
          )}
          <SearchSourceCoverage summaries={sourceCoverage} />
        </div>
      )}

      {results && searchState && results.length === 0 && sourceCoverage.length > 0 && (
        <SearchSourceCoverage summaries={sourceCoverage} />
      )}

      {topMatches.length > 0 && results && (
        <ResultSection title="Top results" count={topMatches.length}>
          <VirtualList
            items={topMatches}
            estimateSize={56}
            label="Top search results"
            getItemKey={(song) => song.id}
            className="border-y border-[var(--glass-border)]"
            renderItem={(song, index) => (
              <SongCard
                song={song}
                index={index}
                tracks={results}
                showIndex={false}
                onNavigateWithItem={onNavigateWithItem}
              />
            )}
          />
        </ResultSection>
      )}

      {artists.length > 0 && (
        <ResultSection title="Artists" count={artists.length}>
          <div className={TILE_GRID}>
            {artists.map((artist, index) => (
              <ArtistTile key={artist.id} artist={artist} eager={index === 0} onNavigateWithItem={onNavigateWithItem} />
            ))}
          </div>
        </ResultSection>
      )}

      {albums.length > 0 && (
        <ResultSection title="Albums" count={albums.length}>
          <div className={TILE_GRID}>
            {albums.map((album, index) => (
              <AlbumTile key={album.id} album={album} eager={index === 0} onNavigateWithItem={onNavigateWithItem} />
            ))}
          </div>
        </ResultSection>
      )}

      {remainingTracks.length > 0 && results && (
        <ResultSection title="More tracks" count={remainingTracks.length}>
          <VirtualList
            items={remainingTracks}
            estimateSize={56}
            label="More search results"
            getItemKey={(song) => song.id}
            className="border-y border-[var(--glass-border)]"
            renderItem={(song, index) => (
              <SongCard
                song={song}
                index={topMatches.length + index}
                tracks={results}
                showIndex={false}
                onNavigateWithItem={onNavigateWithItem}
              />
            )}
          />
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
