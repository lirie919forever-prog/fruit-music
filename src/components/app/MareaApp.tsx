'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Providers } from '@/app/providers';
import { NowPlayingBar } from '@/components/player/NowPlayingBar';
import { CoverArt } from '@/components/ui/CoverArt';
import { Sidebar, MobileNavigation } from '@/components/layout/Sidebar';
import { ProviderDetailView } from '@/components/views/ProviderDetailView';
import { AlbumGrid } from '@/components/views/AlbumGrid';
import { ArtistGrid } from '@/components/views/ArtistGrid';
import { CategoryGrid, type CategoryConfig } from '@/components/views/CategoryGrid';
import { PersonalLibraryView } from '@/components/views/PersonalLibraryView';
import { NowPlayingView } from '@/components/views/NowPlayingView';
import { PlaylistsView } from '@/components/views/PlaylistsView';
import { NewView } from '@/components/views/NewView';
import { SearchView } from '@/components/views/SearchView';
import { api } from '@/lib/api';
import { buildNavigationUrl, parseNavigation, type NavigationItem } from '@/lib/navigation';
import { getViewTitle } from '@/lib/theme';
import { PlayerStoreProvider, usePlayerStore } from '@/store/playerStore';
import type { ViewType } from '@/types/music';

/**
 * Said once, on every chart page. These are Apple's own published charts played
 * through Apple's own preview clips, which are thirty seconds long — a fact the
 * page has to state up front rather than let a listener discover when the audio
 * stops a third of the way through.
 */
const CHART_NOTE = 'Apple’s published chart — each track plays as a 30-second preview';

/** Everything a view needs from the shell to render itself. */
interface ViewContext {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onNavigateWithItem: (view: ViewType, item: NavigationItem | null) => void;
  onNavigate: (view: ViewType) => void;
}

/**
 * A category view is fully described by its config, so the table holds the
 * config and this turns it into the render call. Named for the lint rule and
 * for a readable component stack.
 */
function category(config: CategoryConfig): (context: ViewContext) => ReactNode {
  function CategoryView({ onNavigateWithItem }: ViewContext) {
    return <CategoryGrid config={config} onNavigateWithItem={onNavigateWithItem} />;
  }
  return CategoryView;
}

/**
 * Every renderable view, in one table.
 *
 * `satisfies Record<ViewType, …>` is the point: this used to be a fifteen-branch
 * if-chain ending in `return <AlbumGrid />`, so adding a `ViewType` and
 * forgetting to handle it compiled cleanly and silently rendered the album grid
 * instead. Now it is a type error.
 *
 * The fetchers call `api` directly. They used to `await import('@/lib/api')` for
 * code splitting that does not exist: AudioProvider imports the same module
 * statically and is mounted on every route, so the chunk is always already
 * loaded by the time any of these run.
 */
const VIEWS = {
  new: ({ onNavigateWithItem }) => <NewView onNavigateWithItem={onNavigateWithItem} />,
  albums: ({ onNavigateWithItem }) => <AlbumGrid onNavigateWithItem={onNavigateWithItem} />,
  artists: ({ onNavigateWithItem }) => <ArtistGrid onNavigateWithItem={onNavigateWithItem} />,
  search: ({ searchQuery, onSearchQueryChange, onNavigateWithItem }) => (
    <SearchView query={searchQuery} onQueryChange={onSearchQueryChange} onNavigateWithItem={onNavigateWithItem} />
  ),
  favorites: ({ onNavigateWithItem, onNavigate }) => (
    <PersonalLibraryView kind="favorites" onNavigateWithItem={onNavigateWithItem} onNavigate={onNavigate} />
  ),
  history: ({ onNavigateWithItem, onNavigate }) => (
    <PersonalLibraryView kind="history" onNavigateWithItem={onNavigateWithItem} onNavigate={onNavigate} />
  ),
  playlist: ({ onNavigateWithItem, onNavigate }) => (
    <PlaylistsView onNavigateWithItem={onNavigateWithItem} onNavigate={onNavigate} />
  ),
  'now-playing': ({ onNavigateWithItem }) => <NowPlayingView onNavigateWithItem={onNavigateWithItem} />,

  pop: category({
    view: 'pop',
    title: 'Pop',
    description: 'Apple previews and full-length Creative Commons tracks',
    fetchFn: (signal) => api.getGenreSongs('pop', 50, signal),
    queryKey: ['pop'],
  }),
  billboard: category({
    view: 'billboard',
    title: 'US Top Songs',
    description: CHART_NOTE,
    fetchFn: (signal) => api.getChartSongs('billboard', signal),
    queryKey: ['chart', 'billboard'],
  }),
  uk: category({
    view: 'uk',
    title: 'UK Top Songs',
    description: CHART_NOTE,
    fetchFn: (signal) => api.getChartSongs('uk', signal),
    queryKey: ['chart', 'uk'],
  }),
  jp: category({
    view: 'jp',
    title: 'Japan Top Songs',
    description: CHART_NOTE,
    fetchFn: (signal) => api.getChartSongs('jp', signal),
    queryKey: ['chart', 'jp'],
  }),
  trending: category({
    view: 'trending',
    title: 'Trending',
    description: 'Apple’s US chart mixed with featured Jamendo and ccMixter tracks',
    fetchFn: (signal) => api.getTrending(50, signal),
    queryKey: ['trending'],
  }),
  remixes: category({
    view: 'remixes',
    title: 'Remixes',
    description: 'Remixes from Apple previews and the open music catalog',
    fetchFn: (signal) => api.getGenreSongs('remix', 50, signal),
    queryKey: ['remixes'],
  }),
  jazz: category({
    view: 'jazz',
    title: 'Jazz',
    description: 'Jazz from Apple previews and the open music catalog',
    fetchFn: (signal) => api.getGenreSongs('jazz', 50, signal),
    queryKey: ['jazz'],
  }),
  classical: category({
    view: 'classical',
    title: 'Classical',
    description: 'Classical previews and full-length open recordings',
    fetchFn: (signal) => api.getGenreSongs('classical', 50, signal),
    queryKey: ['classical'],
  }),
} satisfies Record<ViewType, (context: ViewContext) => ReactNode>;

function renderView(currentView: ViewType, context: ViewContext): ReactNode {
  return VIEWS[currentView](context);
}

function MainContent({ initialItem }: { initialItem: NavigationItem | null }) {
  const currentView = usePlayerStore((state) => state.currentView);
  const searchQuery = usePlayerStore((state) => state.searchQuery);
  const setCurrentView = usePlayerStore((state) => state.setCurrentView);
  const setSearchQuery = usePlayerStore((state) => state.setSearchQuery);
  const currentSong = usePlayerStore((state) => state.currentSong);
  const previousViewRef = useRef(currentView);
  const [pendingItem, setPendingItem] = useState<NavigationItem | null>(initialItem);

  const replaceSearchQuery = useCallback(
    (query: string) => {
      setSearchQuery(query);
      const nextUrl = buildNavigationUrl(window.location, 'search', query);
      window.history.replaceState(null, '', nextUrl);
    },
    [setSearchQuery],
  );

  useEffect(() => {
    const navigation = parseNavigation(window.location.search);
    const canonicalUrl = buildNavigationUrl(window.location, navigation.view, navigation.query, navigation.item);
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (canonicalUrl !== currentUrl) window.history.replaceState(null, '', canonicalUrl);

    const onPopState = () => {
      const nav = parseNavigation(window.location.search);
      previousViewRef.current = nav.view;
      setPendingItem(nav.item);
      setCurrentView(nav.view);
      setSearchQuery(nav.query);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [setCurrentView, setSearchQuery]);

  useEffect(() => {
    if (previousViewRef.current === currentView) return;
    previousViewRef.current = currentView;
    const locationNavigation = parseNavigation(window.location.search);
    const item = locationNavigation.view === currentView ? locationNavigation.item : null;
    setPendingItem(item);
    const nextUrl = buildNavigationUrl(window.location, currentView, searchQuery, item);
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.pushState(null, '', nextUrl);
  }, [currentView, searchQuery]);

  const navigateToView = useCallback(
    (view: ViewType) => {
      const nextUrl = buildNavigationUrl(window.location, view);
      window.history.pushState(null, '', nextUrl);
      setPendingItem(null);
      setCurrentView(view);
    },
    [setCurrentView],
  );

  const navigateWithItem = useCallback(
    (view: ViewType, item: NavigationItem | null) => {
      const nextUrl = buildNavigationUrl(window.location, view, '', item);
      window.history.pushState(null, '', nextUrl);
      setCurrentView(view);
      setPendingItem(item);
    },
    [setCurrentView],
  );

  const closeDetail = useCallback(() => {
    const nextUrl = buildNavigationUrl(window.location, currentView, searchQuery, null);
    window.history.pushState(null, '', nextUrl);
    setPendingItem(null);
  }, [currentView, searchQuery]);

  const showDetailOverlay = pendingItem && (pendingItem.kind === 'album' || pendingItem.kind === 'artist');

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--sea-abyss)] text-[var(--salt-white)]">
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-[100] focus-visible:rounded-full focus-visible:bg-[var(--salt-primary)] focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-white focus-visible:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--salt-primary)]"
      >
        Skip to content
      </a>
      {/* The blurred-artwork wash belongs to the full player, where the artwork
			    is the subject. Behind a browse grid it tints every thumbnail on the
			    page toward whatever happens to be playing. */}
      {currentView === 'now-playing' && (
        <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
          {currentSong ? (
            <CoverArt
              src={currentSong.coverArt || '/placeholder-album.svg'}
              alt=""
              aria-hidden
              className="ambient-artwork"
            />
          ) : (
            <div className="ambient-artwork ambient-artwork--idle" />
          )}
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.8),rgba(226,245,255,0.52))]" />
        </div>
      )}
      <div className="relative z-10 flex h-full min-h-0 w-full">
        <Sidebar onNavigate={navigateToView} />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* No rule or blur under the title: content scrolls in its own pane
					    below it, so the header shares the page surface and the whole
					    view reads as one continuous sheet. */}
          {/* Header and content share one max width so the title stays aligned
					    with the rows beneath it. Uncapped, a single-column track list
					    stretches the full width of an ultrawide display and leaves the
					    title marooned from its own controls. */}
          <header className="flex shrink-0 justify-center px-3 pb-2 pt-5 sm:px-6 sm:pb-3 sm:pt-8">
            <div className="flex w-full max-w-[1400px] items-center gap-3">
              <MobileNavigation onNavigate={navigateToView} />
              <h1 className="min-w-0 truncate text-[26px] font-bold leading-[1.18] tracking-[-0.02em] text-[var(--salt-white)] sm:text-[34px]">
                {getViewTitle(currentView)}
              </h1>
            </div>
          </header>
          <div
            id="main-content"
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-y-auto px-3 outline-none sm:px-6"
            style={{ paddingBottom: 'var(--player-bar-clearance)' }}
          >
            <div className="mx-auto w-full max-w-[1400px]">
              {showDetailOverlay && pendingItem?.kind === 'album' && (
                <ProviderDetailView
                  kind="album"
                  id={pendingItem.id}
                  onClose={closeDetail}
                  onNavigateWithItem={navigateWithItem}
                />
              )}
              {showDetailOverlay && pendingItem?.kind === 'artist' && (
                <ProviderDetailView
                  kind="artist"
                  id={pendingItem.id}
                  onClose={closeDetail}
                  onNavigateWithItem={navigateWithItem}
                />
              )}
              {!showDetailOverlay &&
                renderView(currentView, {
                  searchQuery,
                  onSearchQueryChange: replaceSearchQuery,
                  onNavigateWithItem: navigateWithItem,
                  onNavigate: navigateToView,
                })}
            </div>
          </div>
        </main>
      </div>
      <NowPlayingBar onNavigateWithItem={navigateWithItem} />
    </div>
  );
}

export function MareaApp({
  initialView,
  initialQuery,
  initialItem,
}: {
  initialView: ViewType;
  initialQuery: string;
  initialItem: NavigationItem | null;
}) {
  return (
    <PlayerStoreProvider initialView={initialView} initialQuery={initialQuery}>
      <Providers>
        <MainContent initialItem={initialItem} />
      </Providers>
    </PlayerStoreProvider>
  );
}
