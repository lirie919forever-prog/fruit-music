'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Providers } from '@/app/providers';
import { NowPlayingBar } from '@/components/player/NowPlayingBar';
import { CoverArt } from '@/components/ui/CoverArt';
import { Sidebar, MobileNavigation } from '@/components/layout/Sidebar';
import { ProviderDetailView } from '@/components/views/ProviderDetailView';
import { AlbumGrid } from '@/components/views/AlbumGrid';
import { ArtistGrid } from '@/components/views/ArtistGrid';
import { CategoryGrid } from '@/components/views/CategoryGrid';
import { PersonalLibraryView } from '@/components/views/PersonalLibraryView';
import { NowPlayingView } from '@/components/views/NowPlayingView';
import { NewView } from '@/components/views/NewView';
import { SearchView } from '@/components/views/SearchView';
import { buildNavigationUrl, parseNavigation, type NavigationItem } from '@/lib/navigation';
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

async function getBillboardSongs(signal?: AbortSignal) {
	const { api } = await import('@/lib/api');
	return api.getChartSongs('billboard', signal);
}

async function getUkChartSongs(signal?: AbortSignal) {
	const { api } = await import('@/lib/api');
	return api.getChartSongs('uk', signal);
}

async function getJpChartSongs(signal?: AbortSignal) {
	const { api } = await import('@/lib/api');
	return api.getChartSongs('jp', signal);
}

async function getTrendingSongs(signal?: AbortSignal) {
	const { api } = await import('@/lib/api');
	return api.getTrending(50, signal);
}

async function getRemixSongs(signal?: AbortSignal) {
	const { api } = await import('@/lib/api');
	return api.getCcmixterSongsByTag('remix', 50, signal);
}

async function getJazzSongs(signal?: AbortSignal) {
	const { api } = await import('@/lib/api');
	return api.getCcmixterSongsByTag('jazz', 50, signal);
}

async function getClassicalSongs(signal?: AbortSignal) {
	const { api } = await import('@/lib/api');
	return api.getSongsByTag('classical', 50, signal);
}

function renderView(
	currentView: ViewType,
	searchQuery: string,
	onSearchQueryChange: (value: string) => void,
	onNavigateWithItem: (view: ViewType, item: NavigationItem | null) => void,
) {
	const lxEnabled = process.env.NEXT_PUBLIC_LX_ENABLED === 'true';
	if (currentView === 'new') return <NewView onNavigateWithItem={onNavigateWithItem} />;
	if (currentView === 'albums') return <AlbumGrid onNavigateWithItem={onNavigateWithItem} />;
	if (currentView === 'artists') return <ArtistGrid onNavigateWithItem={onNavigateWithItem} />;
	if (currentView === 'search') return <SearchView query={searchQuery} onQueryChange={onSearchQueryChange} />;
	if (currentView === 'favorites') return <PersonalLibraryView kind="favorites" />;
	if (currentView === 'history') return <PersonalLibraryView kind="history" />;
	if (currentView === 'now-playing') return <NowPlayingView />;
	if (currentView === 'pop') return <CategoryGrid config={{ view: 'pop', title: 'Pop', description: 'Pop tracks from Jamendo', fetchFn: getPopSongs, queryKey: ['pop'] }} />;
	if (currentView === 'billboard') return <CategoryGrid config={{ view: 'billboard', title: 'US Top Songs', description: 'Apple US chart metadata with optional configured playback', fetchFn: getBillboardSongs, queryKey: ['chart', 'billboard'] }} />;
	if (currentView === 'uk') return <CategoryGrid config={{ view: 'uk', title: 'UK Top Songs', description: 'Apple UK chart metadata with optional configured playback', fetchFn: getUkChartSongs, queryKey: ['chart', 'uk'] }} />;
	if (currentView === 'jp') return <CategoryGrid config={lxEnabled
		? { view: 'jp', title: 'Japan Top Songs', description: 'Apple Japan chart metadata with optional configured playback', fetchFn: getJpChartSongs, queryKey: ['chart', 'jp'] }
		: { view: 'jp', title: 'J-Pop', description: 'Verified J-Pop tracks from Jamendo', fetchFn: getJpopSongs, queryKey: ['jp'] }} />;
	if (currentView === 'trending') return <CategoryGrid config={{ view: 'trending', title: 'Trending', description: 'Featured Jamendo tracks and ccMixter remixes', fetchFn: getTrendingSongs, queryKey: ['trending'] }} />;
	if (currentView === 'remixes') return <CategoryGrid config={{ view: 'remixes', title: 'Remixes', description: 'Creative remixes from ccMixter', fetchFn: getRemixSongs, queryKey: ['remixes'] }} />;
	if (currentView === 'jazz') return <CategoryGrid config={{ view: 'jazz', title: 'Jazz', description: 'Jazz tracks from ccMixter', fetchFn: getJazzSongs, queryKey: ['jazz'] }} />;
	if (currentView === 'classical') return <CategoryGrid config={{ view: 'classical', title: 'Classical', description: 'Classical tracks from Jamendo', fetchFn: getClassicalSongs, queryKey: ['classical'] }} />;
	return <AlbumGrid onNavigateWithItem={onNavigateWithItem} />;
}

function MainContent({ initialItem }: { initialItem: NavigationItem | null }) {
	const currentView = usePlayerStore((state) => state.currentView);
	const searchQuery = usePlayerStore((state) => state.searchQuery);
	const setCurrentView = usePlayerStore((state) => state.setCurrentView);
	const setSearchQuery = usePlayerStore((state) => state.setSearchQuery);
	const currentSong = usePlayerStore((state) => state.currentSong);
	const previousViewRef = useRef(currentView);
	const [pendingItem, setPendingItem] = useState<NavigationItem | null>(initialItem);

	const replaceSearchQuery = useCallback((query: string) => {
		setSearchQuery(query);
		const nextUrl = buildNavigationUrl(window.location, 'search', query);
		window.history.replaceState(null, '', nextUrl);
	}, [setSearchQuery]);

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

	const navigateToView = useCallback((view: ViewType) => {
		const nextUrl = buildNavigationUrl(window.location, view);
		window.history.pushState(null, '', nextUrl);
		setPendingItem(null);
		setCurrentView(view);
	}, [setCurrentView]);

	const navigateWithItem = useCallback((view: ViewType, item: NavigationItem | null) => {
		const nextUrl = buildNavigationUrl(window.location, view, '', item);
		window.history.pushState(null, '', nextUrl);
		setCurrentView(view);
		setPendingItem(item);
	}, [setCurrentView]);

	const closeDetail = useCallback(() => {
		const nextUrl = buildNavigationUrl(window.location, currentView, searchQuery, null);
		window.history.pushState(null, '', nextUrl);
		setPendingItem(null);
	}, [currentView, searchQuery]);

	const showDetailOverlay = pendingItem && (pendingItem.kind === 'album' || pendingItem.kind === 'artist');

	return (
		<div className="flex h-dvh overflow-hidden bg-[var(--sea-abyss)] text-[var(--salt-white)]">
			<div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
				{currentSong ? <CoverArt src={currentSong.coverArt || '/placeholder-album.svg'} alt="" aria-hidden className="ambient-artwork" /> : <div className="ambient-artwork ambient-artwork--idle" />}
				<div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.8),rgba(226,245,255,0.52))]" />
			</div>
			<div className="relative z-10 flex h-full min-h-0 w-full">
				<Sidebar onNavigate={navigateToView} />
				<main className="flex min-h-0 min-w-0 flex-1 flex-col">
					<header className="flex shrink-0 items-center gap-3 border-b border-[var(--glass-border)] bg-[rgba(255,255,255,0.48)] px-4 py-4 backdrop-blur-xl sm:px-6 sm:py-5">
						<MobileNavigation onNavigate={navigateToView} />
						<h1 className="min-w-0 truncate text-2xl font-bold tracking-[-0.03em] text-[var(--salt-white)] sm:text-3xl">{getViewTitle(currentView)}</h1>
					</header>
					<div className="min-h-0 flex-1 overflow-y-auto px-3 sm:px-6" style={{ paddingBottom: '88px' }}>
						{showDetailOverlay && pendingItem?.kind === 'album' && <ProviderDetailView kind="album" id={pendingItem.id} onClose={closeDetail} />}
						{showDetailOverlay && pendingItem?.kind === 'artist' && <ProviderDetailView kind="artist" id={pendingItem.id} onClose={closeDetail} />}
						{!showDetailOverlay && renderView(currentView, searchQuery, replaceSearchQuery, navigateWithItem)}
					</div>
				</main>
			</div>
			<NowPlayingBar />
		</div>
	);
}

export function MareaApp({ initialView, initialQuery, initialItem }: { initialView: ViewType; initialQuery: string; initialItem: NavigationItem | null }) {
	return (
		<PlayerStoreProvider initialView={initialView} initialQuery={initialQuery}>
			<Providers><MainContent initialItem={initialItem} /></Providers>
		</PlayerStoreProvider>
	);
}
