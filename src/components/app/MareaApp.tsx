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
import { PlaylistsView } from '@/components/views/PlaylistsView';
import { NewView } from '@/components/views/NewView';
import { SearchView } from '@/components/views/SearchView';
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

async function getPopSongs(signal?: AbortSignal) {
	const { api } = await import('@/lib/api');
	return api.getChartSongs('pop', signal);
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
	onNavigateToView: (view: ViewType) => void,
) {
	if (currentView === 'new') return <NewView onNavigateWithItem={onNavigateWithItem} />;
	if (currentView === 'albums') return <AlbumGrid onNavigateWithItem={onNavigateWithItem} />;
	if (currentView === 'artists') return <ArtistGrid onNavigateWithItem={onNavigateWithItem} />;
	if (currentView === 'search') return <SearchView query={searchQuery} onQueryChange={onSearchQueryChange} onNavigateWithItem={onNavigateWithItem} />;
	if (currentView === 'favorites') return <PersonalLibraryView kind="favorites" onNavigateWithItem={onNavigateWithItem} onNavigate={onNavigateToView} />;
	if (currentView === 'history') return <PersonalLibraryView kind="history" onNavigateWithItem={onNavigateWithItem} onNavigate={onNavigateToView} />;
	if (currentView === 'playlist') return <PlaylistsView onNavigateWithItem={onNavigateWithItem} onNavigate={onNavigateToView} />;
	if (currentView === 'now-playing') return <NowPlayingView onNavigateWithItem={onNavigateWithItem} />;
	if (currentView === 'pop') return <CategoryGrid config={{ view: 'pop', title: 'Top Songs', description: CHART_NOTE, fetchFn: getPopSongs, queryKey: ['chart', 'pop'] }} onNavigateWithItem={onNavigateWithItem} />;
	if (currentView === 'billboard') return <CategoryGrid config={{ view: 'billboard', title: 'US Top Songs', description: CHART_NOTE, fetchFn: getBillboardSongs, queryKey: ['chart', 'billboard'] }} onNavigateWithItem={onNavigateWithItem} />;
	if (currentView === 'uk') return <CategoryGrid config={{ view: 'uk', title: 'UK Top Songs', description: CHART_NOTE, fetchFn: getUkChartSongs, queryKey: ['chart', 'uk'] }} onNavigateWithItem={onNavigateWithItem} />;
	if (currentView === 'jp') return <CategoryGrid config={{ view: 'jp', title: 'Japan Top Songs', description: CHART_NOTE, fetchFn: getJpChartSongs, queryKey: ['chart', 'jp'] }} onNavigateWithItem={onNavigateWithItem} />;
	if (currentView === 'trending') return <CategoryGrid config={{ view: 'trending', title: 'Trending', description: 'Featured Jamendo tracks and ccMixter remixes', fetchFn: getTrendingSongs, queryKey: ['trending'] }} onNavigateWithItem={onNavigateWithItem} />;
	if (currentView === 'remixes') return <CategoryGrid config={{ view: 'remixes', title: 'Remixes', description: 'Creative remixes from ccMixter', fetchFn: getRemixSongs, queryKey: ['remixes'] }} onNavigateWithItem={onNavigateWithItem} />;
	if (currentView === 'jazz') return <CategoryGrid config={{ view: 'jazz', title: 'Jazz', description: 'Jazz tracks from ccMixter', fetchFn: getJazzSongs, queryKey: ['jazz'] }} onNavigateWithItem={onNavigateWithItem} />;
	if (currentView === 'classical') return <CategoryGrid config={{ view: 'classical', title: 'Classical', description: 'Classical tracks from Jamendo', fetchFn: getClassicalSongs, queryKey: ['classical'] }} onNavigateWithItem={onNavigateWithItem} />;
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
					{currentSong ? <CoverArt src={currentSong.coverArt || '/placeholder-album.svg'} alt="" aria-hidden className="ambient-artwork" /> : <div className="ambient-artwork ambient-artwork--idle" />}
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
							<h1 className="min-w-0 truncate text-[26px] font-bold leading-[1.18] tracking-[-0.02em] text-[var(--salt-white)] sm:text-[34px]">{getViewTitle(currentView)}</h1>
						</div>
					</header>
					<div id="main-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto px-3 outline-none sm:px-6" style={{ paddingBottom: '88px' }}>
						<div className="mx-auto w-full max-w-[1400px]">
							{showDetailOverlay && pendingItem?.kind === 'album' && <ProviderDetailView kind="album" id={pendingItem.id} onClose={closeDetail} onNavigateWithItem={navigateWithItem} />}
							{showDetailOverlay && pendingItem?.kind === 'artist' && <ProviderDetailView kind="artist" id={pendingItem.id} onClose={closeDetail} onNavigateWithItem={navigateWithItem} />}
							{!showDetailOverlay && renderView(currentView, searchQuery, replaceSearchQuery, navigateWithItem, navigateToView)}
						</div>
					</div>
				</main>
			</div>
			<NowPlayingBar onNavigateWithItem={navigateWithItem} />
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
