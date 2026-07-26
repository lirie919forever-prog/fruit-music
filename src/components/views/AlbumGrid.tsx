'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePlayerStore } from '@/store/playerStore';
import { api } from '@/lib/api';
import { providerErrorMessage } from '@/lib/providers/errors';
import { catalogStaleTime, countFederatedResults } from '@/lib/catalogFreshness';
import { CoverArt } from '@/components/ui/CoverArt';
import type { ViewType } from '@/types/music';
import type { NavigationItem } from '@/lib/navigation';
import type { Album } from '@/types/music';

export function AlbumGrid({ onNavigateWithItem }: { onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void }) {
	const { data: albumState, isLoading, isError, error, refetch } = useQuery({
		queryKey: ['albums'],
		queryFn: ({ signal }) => api.getAlbums(signal),
		staleTime: catalogStaleTime(countFederatedResults),
	});
	const albums = albumState?.results;
	const failedProviders = albumState?.failedProviders ?? [];
	const degradedProviders = albumState?.degradedProviders ?? [];
	const unavailableProviders = [...new Set([...failedProviders, ...degradedProviders])];
	const allProvidersFailed = Boolean(albumState && unavailableProviders.length === albumState.providerCount);

	if (isLoading) return <AlbumSkeleton />;
	if (isError) return <Failure message={providerErrorMessage(error)} retry={() => void refetch()} />;
	if (allProvidersFailed) return <Failure message="Album providers are unavailable. Please try again." retry={() => void refetch()} />;
	if (!albums?.length) return <EmptyAlbums providers={unavailableProviders} retry={() => void refetch()} />;

	return (
		<section className="pb-[88px]">
			<div className="px-4 pb-4 pt-5 sm:px-6">
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div>
						<p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--salt-mist)]">Your library</p>
						<h2 className="mt-1 text-[28px] font-semibold italic text-[var(--salt-white)]" style={{ fontFamily: 'var(--font-display)' }}>Albums</h2>
					</div>
					<p className="text-xs text-[var(--salt-mist)]">{albums.length} available {albums.length === 1 ? 'album' : 'albums'}</p>
				</div>
				{unavailableProviders.length > 0 && <p className="mt-2 text-xs text-[var(--salt-mist)]">{unavailableProviders.join(', ')} {unavailableProviders.length === 1 ? 'is' : 'are'} unavailable. Showing available albums.</p>}
			</div>
			<div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-5 sm:px-6">
				{albums.map((album) => <AlbumCard key={album.id} album={album} onNavigateWithItem={onNavigateWithItem} />)}
			</div>
		</section>
	);
}

function AlbumCard({ album, onNavigateWithItem }: { album: Album; onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void }) {
	const playAlbum = usePlayerStore((state) => state.playAlbum);
	const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
	const requestRef = useRef<AbortController | null>(null);

	useEffect(() => () => requestRef.current?.abort(), []);

	const openDetail = () => {
		onNavigateWithItem?.('albums', { kind: 'album', id: album.id });
	};

	const loadAndPlay = async () => {
		if (state === 'loading') return;
		requestRef.current?.abort();
		const controller = new AbortController();
		requestRef.current = controller;
		setState('loading');
		try {
			const songs = await api.getAlbumSongs(album.id, controller.signal);
			if (!songs.length) throw new Error('No verified tracks are available for this album.');
			playAlbum(songs, 0);
			setState('idle');
		} catch {
			if (!controller.signal.aborted) setState('error');
		} finally {
			if (requestRef.current === controller) requestRef.current = null;
		}
	};

	const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
		if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
			void loadAndPlay();
			return;
		}
		openDetail();
	};

	return (
		<article className="min-w-0">
			<button
				type="button"
				onClick={handleClick}
				aria-label={`Open ${album.name} by ${album.artist}`}
				className="group block w-full rounded-[22px] border border-transparent p-2 text-left transition-[background,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-[var(--glass-border)] hover:bg-[rgba(255,255,255,0.68)] hover:shadow-[0_12px_26px_rgba(47,119,157,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
			>
				<div className="relative aspect-square overflow-hidden rounded-[18px] border border-white shadow-[0_8px_22px_rgba(47,119,157,0.14)]">
					<CoverArt src={album.coverArt} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
					<span className="absolute inset-0 flex items-center justify-center bg-[rgba(22,103,146,0.2)] text-lg text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{state === 'loading' ? '…' : '▸'}</span>
				</div>
				<span className="mt-3 block truncate text-sm font-semibold text-[var(--salt-white)]">{album.name}</span>
				<span className="block truncate text-xs text-[var(--salt-mist)]">{album.artist}</span>
			</button>
			{state === 'error' && <p className="mt-1 text-xs text-[var(--danger)]">Could not load verified tracks. <button type="button" onClick={() => void loadAndPlay()} className="underline">Try again</button></p>}
		</article>
	);
}

function EmptyAlbums({ providers, retry }: { providers: string[]; retry: () => void }) {
	return (
		<div className="mx-4 my-8 rounded-[28px] border border-[var(--glass-border)] bg-[rgba(255,255,255,0.46)] px-6 py-10 text-[var(--salt-mist)] shadow-[0_16px_40px_rgba(47,119,157,0.08)] sm:mx-6">
			<p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--salt-primary)]">Albums are temporarily empty</p>
			<h2 className="mt-2 text-xl font-semibold text-[var(--salt-white)]">No provider-backed albums are available right now.</h2>
			<p className="mt-2 max-w-xl text-sm leading-6">The album view only shows records returned by configured music providers. No placeholder or unverified albums are inserted.</p>
			{providers.length > 0 && <p className="mt-3 text-xs">Unavailable or degraded: {providers.join(', ')}</p>}
			<button type="button" onClick={retry} className="mt-5 rounded-full border border-[var(--glass-border-active)] px-4 py-2 text-sm font-semibold text-[var(--salt-white)] transition hover:bg-[var(--glass-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]">Refresh albums</button>
		</div>
	);
}

function Failure({ message, retry }: { message: string; retry: () => void }) {
	return <div className="flex flex-col items-start gap-3 px-4 py-10 text-[var(--salt-mist)] sm:px-6"><p>{message}</p><button type="button" onClick={retry} className="rounded-full border border-[var(--glass-border-active)] px-4 py-2 text-sm text-[var(--salt-white)]">Try again</button></div>;
}

function AlbumSkeleton() {
	return (
		<section aria-label="Loading albums" className="pb-[88px]">
			<div className="px-4 pb-4 pt-5 sm:px-6">
				<div className="h-3 w-28 animate-pulse rounded bg-[var(--salt-ghost)]" />
				<div className="mt-2 h-8 w-40 animate-pulse rounded bg-[var(--salt-ghost)]" />
			</div>
			<div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-5 sm:px-6">
				{Array.from({ length: 12 }).map((_, i) => (
					<div key={i} className="space-y-3">
						<div className="aspect-square animate-pulse rounded-[18px] bg-[var(--salt-ghost)]" />
						<div className="h-4 w-4/5 animate-pulse rounded bg-[var(--salt-ghost)]" />
						<div className="h-3 w-2/5 animate-pulse rounded bg-[var(--salt-ghost)]" />
					</div>
				))}
			</div>
			<p className="sr-only">Loading albums</p>
		</section>
	);
}
