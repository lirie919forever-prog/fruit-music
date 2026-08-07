'use client';

import { Settings, Search, Moon, ListMusic, Sun } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Providers } from '@/app/providers';
import { NowPlayingBar } from '@/components/player/NowPlayingBar';
import { QueueDrawer } from '@/components/player/QueueDrawer';
import { QueueRail } from '@/components/player/QueueRail';
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
import { RadioView } from '@/components/views/RadioView';
import { SearchView } from '@/components/views/SearchView';
import { SourceDirectoryView } from '@/components/views/SourceDirectoryView';
import { SettingsDrawer } from '@/components/settings/SettingsDrawer';
import { useToast } from '@/components/ui/Toast';
import { buildNavigationUrl, parseNavigation, type NavigationItem } from '@/lib/navigation';
import { getViewTitle } from '@/lib/theme';
import { useAppSettings } from '@/hooks/useAppSettings';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useLocalMusic } from '@/hooks/useLocalMusic';
import { getDesktopBridge } from '@/lib/desktopBridge';
import { useAudio } from '@/components/player/AudioProvider';
import { PlayerStoreProvider, usePlayerStore } from '@/store/playerStore';
import type { ViewType } from '@/types/music';
import { motion } from 'motion/react';
/**
 * Said once, on every chart page. These are Apple's own published charts played
 * through Apple's own 30-second preview clips. A bounded background pass tries
 * to swap each row for a verified full recording, and keeps Apple's ranking and
 * the preview when it cannot; the note says exactly that rather than promising
 * every entry is a full track.
 */
const CHART_NOTE = 'Apple regional chart — official 30-second previews, full recording when a match confirms one';

/** Everything a view needs from the shell to render itself. */
interface ViewContext {
  searchQuery: string;
  searchSource: string;
  onSearchQueryChange: (value: string) => void;
  onSearchSourceChange: (value: string) => void;
  onSearch: (query: string, source?: string) => void;
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
 * Category fetchers receive the catalog port from CategoryGrid. Keeping the
 * table declarative means the shell does not own provider or network details.
 */
const VIEWS = {
  new: ({ onNavigateWithItem }) => <NewView onNavigateWithItem={onNavigateWithItem} />,
  albums: ({ onNavigateWithItem }) => <AlbumGrid onNavigateWithItem={onNavigateWithItem} />,
  artists: ({ onNavigateWithItem }) => <ArtistGrid onNavigateWithItem={onNavigateWithItem} />,
  search: ({ searchQuery, searchSource, onSearchQueryChange, onSearchSourceChange, onNavigateWithItem }) => (
    <SearchView
      query={searchQuery}
      sourceFilter={searchSource}
      onQueryChange={onSearchQueryChange}
      onSourceFilterChange={onSearchSourceChange}
      onNavigateWithItem={onNavigateWithItem}
    />
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
  radio: ({ onNavigateWithItem }) => <RadioView onNavigateWithItem={onNavigateWithItem} />,
  sources: ({ onSearch }) => <SourceDirectoryView onSearchSource={(source) => onSearch('', source)} />,

  pop: category({
    view: 'pop',
    title: 'Pop',
    description: 'Apple previews and full-length Creative Commons tracks',
    fetchFn: (catalog, signal) => catalog.getGenreSongs('pop', 50, signal),
    queryKey: ['pop'],
  }),
  billboard: category({
    view: 'billboard',
    title: 'US Top Songs',
    description: CHART_NOTE,
    fetchFn: (catalog, signal) => catalog.getChartSongs('billboard', signal),
    queryKey: ['chart', 'billboard'],
    includePreviews: true,
  }),
  uk: category({
    view: 'uk',
    title: 'UK Top Songs',
    description: CHART_NOTE,
    fetchFn: (catalog, signal) => catalog.getChartSongs('uk', signal),
    queryKey: ['chart', 'uk'],
    includePreviews: true,
  }),
  jp: category({
    view: 'jp',
    title: 'Japan Top Songs',
    description: CHART_NOTE,
    fetchFn: (catalog, signal) => catalog.getChartSongs('jp', signal),
    queryKey: ['chart', 'jp'],
    includePreviews: true,
  }),
  trending: category({
    view: 'trending',
    title: 'Trending',
    description: 'Apple’s US chart mixed with featured Jamendo and ccMixter tracks',
    fetchFn: (catalog, signal) => catalog.getTrending(50, signal),
    queryKey: ['trending'],
  }),
  remixes: category({
    view: 'remixes',
    title: 'Remixes',
    description: 'Remixes from Apple previews and the open music catalog',
    fetchFn: (catalog, signal) => catalog.getGenreSongs('remix', 50, signal),
    queryKey: ['remixes'],
  }),
  jazz: category({
    view: 'jazz',
    title: 'Jazz',
    description: 'Jazz from Apple previews and the open music catalog',
    fetchFn: (catalog, signal) => catalog.getGenreSongs('jazz', 50, signal),
    queryKey: ['jazz'],
  }),
  classical: category({
    view: 'classical',
    title: 'Classical',
    description: 'Classical previews and full-length open recordings',
    fetchFn: (catalog, signal) => catalog.getGenreSongs('classical', 50, signal),
    queryKey: ['classical'],
  }),
} satisfies Record<ViewType, (context: ViewContext) => ReactNode>;

function renderView(currentView: ViewType, context: ViewContext): ReactNode {
  return VIEWS[currentView](context);
}

function locationNavigation(initialView: ViewType) {
  const params = new URLSearchParams(window.location.search);
  const navigation = parseNavigation(params);
  if (params.has('view')) return navigation;
  return {
    ...navigation,
    view: initialView,
    query: initialView === 'search' ? (params.get('q') ?? '') : '',
  };
}

function GlobalSearch({ onSubmit }: { onSubmit: (query: string) => void }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', focusSearch);
    return () => document.removeEventListener('keydown', focusSearch);
  }, []);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(query.trim());
      }}
      className="hidden h-9 min-w-0 sm:flex sm:w-[min(31vw,280px)]"
      role="search"
    >
      <label htmlFor="global-music-search" className="sr-only">
        Search music
      </label>
      <div className="marea-glass-control flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 focus-within:ring-2 focus-within:ring-[var(--salt-primary)]/15">
        <Search className="h-4 w-4 shrink-0 text-[var(--salt-mist)]" aria-hidden />
        <input
          ref={inputRef}
          id="global-music-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search music"
          className="min-w-0 flex-1 bg-transparent text-xs text-[var(--salt-white)] outline-none placeholder:text-[var(--salt-mist)]"
        />
      </div>
    </form>
  );
}

function HeaderIconButton({
  label,
  title = label,
  onClick,
  disabled = false,
  expanded,
  className = '',
  children,
}: {
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  expanded?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      aria-expanded={expanded}
      whileTap={{ scale: 0.96 }}
      className={`marea-glass-control flex h-9 w-9 items-center justify-center rounded-lg border text-[var(--salt-mist)] hover:text-[var(--salt-primary)] disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {children}
    </motion.button>
  );
}

function MainContent({
  initialView,
  initialItem,
  initialSearchSource,
}: {
  initialView: ViewType;
  initialItem: NavigationItem | null;
  initialSearchSource: string;
}) {
  const currentView = usePlayerStore((state) => state.currentView);
  const searchQuery = usePlayerStore((state) => state.searchQuery);
  const setCurrentView = usePlayerStore((state) => state.setCurrentView);
  const setSearchQuery = usePlayerStore((state) => state.setSearchQuery);
  const currentSong = usePlayerStore((state) => state.currentSong);
  const previousViewRef = useRef(currentView);
  const [pendingItem, setPendingItem] = useState<NavigationItem | null>(initialItem);
  const [searchSource, setSearchSource] = useState(initialSearchSource);
  const [queueOpen, setQueueOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const localFileInputRef = useRef<HTMLInputElement>(null);
  const setNowPlayingPanel = usePlayerStore((state) => state.setNowPlayingPanel);
  const nowPlayingPanel = usePlayerStore((state) => state.nowPlayingPanel);
  const { settings, updateSettings, resetSettings } = useAppSettings();
  const localMusic = useLocalMusic();
  const { seek } = useAudio();
  const { push } = useToast();

  const replaceSearchQuery = useCallback(
    (query: string) => {
      setSearchQuery(query);
      const nextUrl = buildNavigationUrl(window.location, 'search', query, null, searchSource);
      window.history.replaceState(null, '', nextUrl);
    },
    [searchSource, setSearchQuery],
  );

  useEffect(() => {
    const navigation = locationNavigation(initialView);
    const canonicalUrl = buildNavigationUrl(
      window.location,
      navigation.view,
      navigation.query,
      navigation.item,
      navigation.source,
    );
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (canonicalUrl !== currentUrl) window.history.replaceState(null, '', canonicalUrl);

    const onPopState = () => {
      const nav = locationNavigation(initialView);
      previousViewRef.current = nav.view;
      setPendingItem(nav.item);
      setCurrentView(nav.view);
      setSearchQuery(nav.query);
      setSearchSource(nav.source);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [initialView, setCurrentView, setSearchQuery]);

  useEffect(() => {
    if (previousViewRef.current === currentView) return;
    previousViewRef.current = currentView;
    const locationNavigation = parseNavigation(window.location.search);
    const item = locationNavigation.view === currentView ? locationNavigation.item : null;
    setPendingItem(item);
    const nextUrl = buildNavigationUrl(window.location, currentView, searchQuery, item, searchSource);
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.pushState(null, '', nextUrl);
  }, [currentView, searchQuery, searchSource]);

  const navigateToView = useCallback(
    (view: ViewType) => {
      const nextUrl = buildNavigationUrl(window.location, view);
      window.history.pushState(null, '', nextUrl);
      setPendingItem(null);
      setSearchSource('');
      setCurrentView(view);
    },
    [setCurrentView],
  );

  const toggleLyrics = useCallback(() => {
    const nextPanel = nowPlayingPanel === 'lyrics' ? 'queue' : 'lyrics';
    setNowPlayingPanel(nextPanel);
    if (currentView !== 'now-playing') navigateToView('now-playing');
  }, [currentView, navigateToView, nowPlayingPanel, setNowPlayingPanel]);

  const toggleFullscreenLyrics = useCallback(() => {
    if (!currentSong) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
      return;
    }
    setNowPlayingPanel('lyrics');
    if (currentView !== 'now-playing') navigateToView('now-playing');
    const enterFullscreen = () => {
      const target = document.querySelector<HTMLElement>('[data-marea-lyrics-panel]');
      if (target?.requestFullscreen) void target.requestFullscreen().catch(() => undefined);
    };
    requestAnimationFrame(() => requestAnimationFrame(enterFullscreen));
  }, [currentSong, currentView, navigateToView, setNowPlayingPanel]);

  const toggleQueuePanel = useCallback(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      updateSettings({ queuePanelMode: settings.queuePanelMode === 'hidden' ? 'expanded' : 'hidden' });
      return;
    }
    setQueueOpen((open) => !open);
  }, [settings.queuePanelMode, updateSettings]);

  const importLocalAudio = useCallback(() => {
    localFileInputRef.current?.click();
  }, []);

  const importBackgroundImage = useCallback(
    async (target: 'app' | 'player', file?: File) => {
      if (file) {
        const isImage = file.type.startsWith('image/') || /\.(?:bmp|gif|jpe?g|png|webp)$/i.test(file.name);
        if (!isImage) {
          push('Choose a supported image file.', 'error');
          return;
        }
        if (file.size > 40 * 1024 * 1024) {
          push('Background images must be smaller than 40 MB.', 'error');
          return;
        }
        const url = URL.createObjectURL(file);
        if (target === 'app') updateSettings({ appBackground: 'image', appBackgroundImage: url });
        else updateSettings({ background: 'image', playerBackgroundImage: url });
        return;
      }

      const bridge = getDesktopBridge();
      if (!bridge) {
        push('Choose an image file to set a background.', 'info');
        return;
      }
      try {
        const selection = await bridge.importBackgroundImage();
        if (!selection) return;
        if (target === 'app') updateSettings({ appBackground: 'image', appBackgroundImage: selection.url });
        else updateSettings({ background: 'image', playerBackgroundImage: selection.url });
      } catch {
        push('The background image could not be imported.', 'error');
      }
    },
    [push, updateSettings],
  );

  const removeBackgroundImage = useCallback(
    async (target: 'app' | 'player') => {
      const imageUrl = target === 'app' ? settings.appBackgroundImage : settings.playerBackgroundImage;
      if (!imageUrl) return;

      if (imageUrl.startsWith('file:')) {
        const bridge = getDesktopBridge();
        if (bridge) {
          try {
            await bridge.removeBackgroundImage(imageUrl);
          } catch {
            push('The background image could not be removed.', 'error');
            return;
          }
        }
      } else if (imageUrl.startsWith('blob:')) {
        URL.revokeObjectURL(imageUrl);
      }

      if (target === 'app') updateSettings({ appBackground: 'ocean', appBackgroundImage: null });
      else updateSettings({ background: 'wash', playerBackgroundImage: null });
    },
    [push, settings.appBackgroundImage, settings.playerBackgroundImage, updateSettings],
  );

  const toggleTheme = useCallback(() => {
    updateSettings({ theme: settings.theme === 'midnight' ? 'ocean' : 'midnight' });
  }, [settings.theme, updateSettings]);

  useKeyboardShortcuts({
    seek,
    importLocalAudio,
    toggleLyrics,
    toggleQueue: toggleQueuePanel,
    openSettings: () => setSettingsOpen(true),
    toggleFullscreenLyrics,
    toggleTheme,
  });

  const navigateToSearch = useCallback(
    (query: string, source = '') => {
      const nextUrl = buildNavigationUrl(window.location, 'search', query, null, source);
      window.history.pushState(null, '', nextUrl);
      setPendingItem(null);
      setSearchQuery(query);
      setSearchSource(source);
      setCurrentView('search');
    },
    [setCurrentView, setSearchQuery],
  );

  const openQueue = useCallback(() => {
    setQueueOpen(true);
  }, []);

  const closeQueue = useCallback(() => {
    setQueueOpen(false);
  }, []);

  const openFullPlayer = useCallback(() => {
    setQueueOpen(false);
    setNowPlayingPanel('queue');
    navigateToView('now-playing');
  }, [navigateToView, setNowPlayingPanel]);

  const navigateWithItem = useCallback(
    (view: ViewType, item: NavigationItem | null) => {
      const nextUrl = buildNavigationUrl(window.location, view, '', item, view === 'search' ? searchSource : '');
      window.history.pushState(null, '', nextUrl);
      setCurrentView(view);
      setPendingItem(item);
    },
    [searchSource, setCurrentView],
  );

  const closeDetail = useCallback(() => {
    const nextUrl = buildNavigationUrl(window.location, currentView, searchQuery, null, searchSource);
    window.history.pushState(null, '', nextUrl);
    setPendingItem(null);
  }, [currentView, searchQuery, searchSource]);

  const replaceSearchSource = useCallback(
    (source: string) => {
      setSearchSource(source);
      const nextUrl = buildNavigationUrl(window.location, 'search', searchQuery, null, source);
      window.history.replaceState(null, '', nextUrl);
    },
    [searchQuery],
  );

  const showDetailOverlay = pendingItem && (pendingItem.kind === 'album' || pendingItem.kind === 'artist');

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--sea-abyss)] text-[var(--salt-white)]">
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-[100] focus-visible:rounded-full focus-visible:bg-[var(--salt-primary)] focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-white focus-visible:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--salt-primary)]"
      >
        Skip to content
      </a>
      <div aria-hidden data-marea-app-background className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div
          className={`absolute inset-0 ${
            settings.appBackground === 'plain'
              ? 'bg-[var(--sea-abyss)]'
              : settings.appBackground === 'image' && settings.appBackgroundImage
                ? 'bg-cover bg-center'
                : 'marea-app-background--ocean'
          }`}
          style={
            settings.appBackground === 'image' && settings.appBackgroundImage
              ? { backgroundImage: `url("${settings.appBackgroundImage}")` }
              : undefined
          }
        />
        {settings.appBackground === 'image' && settings.appBackgroundImage && (
          <div className="absolute inset-0 bg-[rgba(251,252,254,0.72)]" />
        )}
      </div>
      {/* The blurred-artwork wash belongs to the full player, where the artwork
          is the subject. Behind a browse grid it tints every thumbnail on the
          page toward whatever happens to be playing. */}
      {currentView === 'now-playing' && settings.background !== 'plain' && (
        <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
          {settings.background === 'image' && settings.playerBackgroundImage ? (
            <div className="ambient-artwork" style={{ backgroundImage: `url("${settings.playerBackgroundImage}")` }} />
          ) : settings.background === 'gradient' ? (
            <div className="ambient-artwork ambient-artwork--gradient" />
          ) : currentSong ? (
            <CoverArt
              src={currentSong.coverArt || '/placeholder-album.svg'}
              alt=""
              aria-hidden
              loading="eager"
              className="ambient-artwork"
            />
          ) : (
            <div className="ambient-artwork ambient-artwork--idle" />
          )}
          <div className="marea-player-overlay absolute inset-0" />
        </div>
      )}
      <div className="relative z-10 flex h-full min-h-0 w-full">
        <Sidebar
          onNavigate={navigateToView}
          mode={settings.sidebarMode}
          onToggle={() =>
            updateSettings({ sidebarMode: settings.sidebarMode === 'expanded' ? 'collapsed' : 'expanded' })
          }
        />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* A light frosted top band keeps orientation and the global controls
              available without boxing the browse content into another card. */}
          {/* Header and content share one max width so the title stays aligned
					    with the rows beneath it. Uncapped, a single-column track list
					    stretches the full width of an ultrawide display and leaves the
					    title marooned from its own controls. */}
          <header className="marea-shell-header flex shrink-0 justify-center px-3 pb-2 pt-5 sm:px-6 sm:pb-3 sm:pt-8">
            <div className="flex w-full max-w-[1400px] items-center gap-3">
              <MobileNavigation onNavigate={navigateToView} />
              <h1 className="min-w-0 truncate text-[22px] font-bold leading-[1.18] tracking-[-0.02em] text-[var(--salt-white)] sm:text-[34px]">
                {getViewTitle(currentView)}
              </h1>
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                <GlobalSearch onSubmit={navigateToSearch} />
                <HeaderIconButton label="Search music" onClick={() => navigateToSearch('')} className="sm:hidden">
                  <Search className="h-4 w-4" aria-hidden />
                </HeaderIconButton>
                <HeaderIconButton
                  label="Open queue"
                  title={currentSong ? 'Open queue' : 'Queue is empty'}
                  onClick={openQueue}
                  disabled={!currentSong}
                >
                  <ListMusic className="h-4 w-4" aria-hidden />
                </HeaderIconButton>
                <HeaderIconButton
                  label={settings.theme === 'midnight' ? 'Switch to Ocean theme' : 'Switch to Midnight theme'}
                  title={settings.theme === 'midnight' ? 'Switch to Ocean theme' : 'Switch to Midnight theme'}
                  onClick={toggleTheme}
                >
                  {settings.theme === 'midnight' ? (
                    <Sun className="h-4 w-4" aria-hidden />
                  ) : (
                    <Moon className="h-4 w-4" aria-hidden />
                  )}
                </HeaderIconButton>
                <HeaderIconButton
                  label="Open settings"
                  title="Open settings"
                  onClick={() => setSettingsOpen(true)}
                  expanded={settingsOpen}
                >
                  <Settings className="h-4 w-4" aria-hidden />
                </HeaderIconButton>
              </div>
            </div>
          </header>
          <div
            id="main-content"
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-y-auto px-3 outline-none sm:px-6"
            style={{
              paddingBottom: currentView === 'now-playing' ? '24px' : 'var(--player-bar-clearance)',
            }}
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
                  searchSource,
                  onSearchQueryChange: replaceSearchQuery,
                  onSearchSourceChange: replaceSearchSource,
                  onSearch: navigateToSearch,
                  onNavigateWithItem: navigateWithItem,
                  onNavigate: navigateToView,
                })}
            </div>
          </div>
        </main>
        {currentView !== 'now-playing' && (
          <QueueRail
            mode={settings.queuePanelMode}
            onModeChange={(mode) => updateSettings({ queuePanelMode: mode })}
            onOpenFullPlayer={openFullPlayer}
          />
        )}
      </div>
      {currentView !== 'now-playing' && <NowPlayingBar onNavigateWithItem={navigateWithItem} onOpenQueue={openQueue} />}
      <QueueDrawer open={queueOpen} onClose={closeQueue} onOpenFullPlayer={openFullPlayer} />
      <input
        ref={localFileInputRef}
        type="file"
        accept="audio/*,.flac"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.currentTarget.value = '';
          if (files.length > 0) void localMusic.importFiles(files);
        }}
      />
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onUpdate={updateSettings}
        onReset={resetSettings}
        localSongs={localMusic.songs}
        localLoading={localMusic.isLoading}
        localError={localMusic.error}
        onImportFiles={localMusic.importFiles}
        onImportDesktopFiles={localMusic.importDesktopFiles}
        onImportBackgroundImage={importBackgroundImage}
        onRemoveBackgroundImage={removeBackgroundImage}
        onRemoveLocalSong={localMusic.removeSong}
        onClearLocalSongs={localMusic.clear}
      />
    </div>
  );
}

export function MareaApp({
  initialView,
  initialQuery,
  initialItem,
  initialSearchSource,
}: {
  initialView: ViewType;
  initialQuery: string;
  initialItem: NavigationItem | null;
  initialSearchSource: string;
}) {
  return (
    <PlayerStoreProvider initialView={initialView} initialQuery={initialQuery}>
      <Providers>
        <MainContent initialView={initialView} initialItem={initialItem} initialSearchSource={initialSearchSource} />
      </Providers>
    </PlayerStoreProvider>
  );
}
