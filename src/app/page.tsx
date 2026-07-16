'use client';

import { useRef } from 'react';
import { Providers } from '@/app/providers';
import { NowPlayingBar } from '@/components/player/NowPlayingBar';
import { Sidebar, MobileNavigation } from '@/components/layout/Sidebar';
import { AlbumGrid } from '@/components/views/AlbumGrid';
import { ArtistGrid } from '@/components/views/ArtistGrid';
import { CategoryGrid } from '@/components/views/CategoryGrid';
import { NowPlayingView } from '@/components/views/NowPlayingView';
import { SearchView } from '@/components/views/SearchView';
import { getViewTitle } from '@/lib/theme';
import { usePlayerStore } from '@/store/playerStore';

async function getPopSongs() {
  const { api } = await import('@/lib/api');
  return api.getSongsByTag('pop', 50);
}

async function getJpopSongs() {
  const { api } = await import('@/lib/api');
  return api.getSongsByTag('jpop', 50);
}

async function getTrendingSongs() {
  const { api } = await import('@/lib/api');
  return api.getTrending(50);
}

async function getRemixSongs() {
  const { ccmixterProvider } = await import('@/lib/providers');
  return ccmixterProvider.getSongsByTag('remix', 50);
}

async function getJazzSongs() {
  const { ccmixterProvider } = await import('@/lib/providers');
  return ccmixterProvider.getSongsByTag('jazz', 50);
}

async function getClassicalSongs() {
  const { api } = await import('@/lib/api');
  return api.getSongsByTag('classical', 50);
}

function renderView(currentView: string) {
  if (currentView === 'albums') return <AlbumGrid />;
  if (currentView === 'artists') return <ArtistGrid />;
  if (currentView === 'search') return <SearchView />;
  if (currentView === 'now-playing') return <NowPlayingView />;
  if (currentView === 'pop') {
    return (
      <CategoryGrid
        config={{
          view: 'pop',
          title: 'Pop',
          description: 'Pop tracks from Jamendo',
          fetchFn: getPopSongs,
          queryKey: ['pop'],
        }}
      />
    );
  }
  if (currentView === 'jp') {
    return (
      <CategoryGrid
        config={{
          view: 'jp',
          title: 'J-Pop',
          description: 'J-Pop tracks from Jamendo',
          fetchFn: getJpopSongs,
          queryKey: ['jp'],
        }}
      />
    );
  }
  if (currentView === 'trending') {
    return (
      <CategoryGrid
        config={{
          view: 'trending',
          title: 'Trending',
          description: 'Featured Jamendo tracks and ccMixter remixes',
          fetchFn: getTrendingSongs,
          queryKey: ['trending'],
        }}
      />
    );
  }
  if (currentView === 'remixes') {
    return (
      <CategoryGrid
        config={{
          view: 'remixes',
          title: 'Remixes',
          description: 'Creative remixes from ccMixter',
          fetchFn: getRemixSongs,
          queryKey: ['remixes'],
        }}
      />
    );
  }
  if (currentView === 'jazz') {
    return (
      <CategoryGrid
        config={{
          view: 'jazz',
          title: 'Jazz',
          description: 'Jazz tracks from ccMixter',
          fetchFn: getJazzSongs,
          queryKey: ['jazz'],
        }}
      />
    );
  }
  if (currentView === 'classical') {
    return (
      <CategoryGrid
        config={{
          view: 'classical',
          title: 'Classical',
          description: 'Classical tracks from Jamendo',
          fetchFn: getClassicalSongs,
          queryKey: ['classical'],
        }}
      />
    );
  }

  return <AlbumGrid />;
}

function MainContent() {
  const currentView = usePlayerStore((s) => s.currentView);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex min-h-dvh bg-[var(--sea-abyss)] text-[var(--salt-white)]">
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        {currentSong ? <img src={currentSong.coverArt} alt="" className="ambient-artwork" /> : <div className="ambient-artwork ambient-artwork--idle" />}
        <div className="absolute inset-0 bg-[rgba(2,8,16,0.68)]" />
      </div>

      <div className="relative z-10 flex min-h-dvh w-full">
        <Sidebar />

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center gap-3 px-4 py-4 sm:px-6 sm:py-5">
            <MobileNavigation />
            <h1 className="min-w-0 truncate text-2xl font-bold tracking-tight text-white sm:text-3xl">{getViewTitle(currentView)}</h1>
          </header>

          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-3 sm:px-6" style={{ paddingBottom: 'calc(88px + env(safe-area-inset-bottom))' }}>
            {renderView(currentView)}
          </div>
        </main>
      </div>

      <NowPlayingBar />
    </div>
  );
}

export default function Home() {
  return (
    <Providers>
      <MainContent />
    </Providers>
  );
}
