'use client';

import { useCallback, useEffect, useRef } from 'react';
import { Providers } from '@/app/providers';
import { NowPlayingBar } from '@/components/player/NowPlayingBar';
import { Sidebar, MobileNavigation } from '@/components/layout/Sidebar';
import { AlbumGrid } from '@/components/views/AlbumGrid';
import { ArtistGrid } from '@/components/views/ArtistGrid';
import { CategoryGrid } from '@/components/views/CategoryGrid';
import { PersonalLibraryView } from '@/components/views/PersonalLibraryView';
import { NowPlayingView } from '@/components/views/NowPlayingView';
import { SearchView } from '@/components/views/SearchView';
import { buildNavigationUrl, parseNavigation } from '@/lib/navigation';
import { getViewTitle } from '@/lib/theme';
import { PlayerStoreProvider, usePlayerStore } from '@/store/playerStore';
import type { ViewType } from '@/types/music';

async function getPopSongs(signal?: AbortSignal) {
  const { api } = await import('@/lib/api');
  return api.getSongsByTag('pop', 50, signal);
}

async function getJpopSongs(signal?: AbortSignal) {
  const { api } = await import('@/lib/api');
  return api.getSongsByTag('jpop', 50, signal);
}

async function getTrendingSongs(signal?: AbortSignal) {
  const { api } = await import('@/lib/api');
  return api.getTrending(50, signal);
}

async function getRemixSongs(signal?: AbortSignal) {
  const { ccmixterProvider } = await import('@/lib/providers');
  return ccmixterProvider.getSongsByTag('remix', 50, signal);
}

async function getJazzSongs(signal?: AbortSignal) {
  const { ccmixterProvider } = await import('@/lib/providers');
  return ccmixterProvider.getSongsByTag('jazz', 50, signal);
}

async function getClassicalSongs(signal?: AbortSignal) {
  const { api } = await import('@/lib/api');
  return api.getSongsByTag('classical', 50, signal);
}

function renderView(currentView: ViewType, searchQuery: string, onSearchQueryChange: (value: string) => void) {
  if (currentView === 'albums') return <AlbumGrid />;
  if (currentView === 'artists') return <ArtistGrid />;
  if (currentView === 'search') return <SearchView query={searchQuery} onQueryChange={onSearchQueryChange} />;
  if (currentView === 'favorites') return <PersonalLibraryView kind="favorites" />;
  if (currentView === 'history') return <PersonalLibraryView kind="history" />;
  if (currentView === 'now-playing') return <NowPlayingView />;
  if (currentView === 'pop') return <CategoryGrid config={{ view: 'pop', title: 'Pop', description: 'Pop tracks from Jamendo', fetchFn: getPopSongs, queryKey: ['pop'] }} />;
  if (currentView === 'jp') return <CategoryGrid config={{ view: 'jp', title: 'J-Pop', description: 'J-Pop tracks from Jamendo', fetchFn: getJpopSongs, queryKey: ['jp'] }} />;
  if (currentView === 'trending') return <CategoryGrid config={{ view: 'trending', title: 'Trending', description: 'Featured Jamendo tracks and ccMixter remixes', fetchFn: getTrendingSongs, queryKey: ['trending'] }} />;
  if (currentView === 'remixes') return <CategoryGrid config={{ view: 'remixes', title: 'Remixes', description: 'Creative remixes from ccMixter', fetchFn: getRemixSongs, queryKey: ['remixes'] }} />;
  if (currentView === 'jazz') return <CategoryGrid config={{ view: 'jazz', title: 'Jazz', description: 'Jazz tracks from ccMixter', fetchFn: getJazzSongs, queryKey: ['jazz'] }} />;
  if (currentView === 'classical') return <CategoryGrid config={{ view: 'classical', title: 'Classical', description: 'Classical tracks from Jamendo', fetchFn: getClassicalSongs, queryKey: ['classical'] }} />;
  return <AlbumGrid />;
}

function MainContent() {
  const currentView = usePlayerStore((state) => state.currentView);
  const searchQuery = usePlayerStore((state) => state.searchQuery);
  const setCurrentView = usePlayerStore((state) => state.setCurrentView);
  const setSearchQuery = usePlayerStore((state) => state.setSearchQuery);
  const currentSong = usePlayerStore((state) => state.currentSong);
  const previousViewRef = useRef(currentView);

  const replaceSearchQuery = useCallback((query: string) => {
    setSearchQuery(query);
    const nextUrl = buildNavigationUrl(window.location, 'search', query);
    window.history.replaceState(null, '', nextUrl);
  }, [setSearchQuery]);

  useEffect(() => {
    const navigation = parseNavigation(window.location.search);
    const canonicalUrl = buildNavigationUrl(window.location, navigation.view, navigation.query);
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (canonicalUrl !== currentUrl) window.history.replaceState(null, '', canonicalUrl);

    const onPopState = () => {
      const navigation = parseNavigation(window.location.search);
      previousViewRef.current = navigation.view;
      setCurrentView(navigation.view);
      setSearchQuery(navigation.query);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [setCurrentView, setSearchQuery]);

  useEffect(() => {
    if (previousViewRef.current === currentView) return;
    previousViewRef.current = currentView;
    const nextUrl = buildNavigationUrl(window.location, currentView, searchQuery);
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.pushState(null, '', nextUrl);
  }, [currentView, searchQuery]);

  return (
    <div className="flex min-h-dvh bg-[var(--sea-abyss)] text-[var(--salt-white)]">
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        {currentSong ? <img src={currentSong.coverArt || '/placeholder-album.svg'} alt="" className="ambient-artwork" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = '/placeholder-album.svg'; }} /> : <div className="ambient-artwork ambient-artwork--idle" />}
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.8),rgba(226,245,255,0.52))]" />
      </div>
      <div className="relative z-10 flex min-h-dvh w-full">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center gap-3 border-b border-[var(--glass-border)] bg-[rgba(255,255,255,0.48)] px-4 py-4 backdrop-blur-xl sm:px-6 sm:py-5">
            <MobileNavigation />
            <h1 className="min-w-0 truncate text-2xl font-bold tracking-[-0.03em] text-[var(--salt-white)] sm:text-3xl">{getViewTitle(currentView)}</h1>
          </header>
          <div className="flex-1 overflow-y-auto px-3 sm:px-6" style={{ paddingBottom: 'calc(88px + env(safe-area-inset-bottom))' }}>
            {renderView(currentView, searchQuery, replaceSearchQuery)}
          </div>
        </main>
      </div>
      <NowPlayingBar />
    </div>
  );
}

export function MareaApp({ initialView, initialQuery }: { initialView: ViewType; initialQuery: string }) {
  return (
    <PlayerStoreProvider initialView={initialView} initialQuery={initialQuery}>
      <Providers><MainContent /></Providers>
    </PlayerStoreProvider>
  );
}
