'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePlayerStore } from '@/store/playerStore';
import { api } from '@/lib/api';
import { providerErrorMessage } from '@/lib/providers/errors';
import { catalogStaleTime, countFederatedResults } from '@/lib/catalogFreshness';
import { HiPlay } from 'react-icons/hi2';
import { CoverArt } from '@/components/ui/CoverArt';
import { StatusButton, StatusPanel } from '@/components/ui/StatusPanel';
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
		<section className="pb-6">
			{/* The page header already says "Albums"; this line carries only what it
			    can't — how many, and whether any source is missing. */}
			<div className="pb-3">
				<p className="text-[13px] text-[var(--salt-mist)]">{albums.length} available {albums.length === 1 ? 'album' : 'albums'}</p>
				{unavailableProviders.length > 0 && <p className="mt-1 text-xs text-[var(--salt-mist)]">{unavailableProviders.join(', ')} {unavailableProviders.length === 1 ? 'is' : 'are'} unavailable. Showing available albums.</p>}
			</div>
			<div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
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
				className="group block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
			>
				<div className="relative aspect-square overflow-hidden rounded-md bg-[var(--salt-ghost)]">
					<CoverArt src={album.coverArt} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
					<span className="absolute inset-0 flex items-center justify-center bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
						{state === 'loading'
							? <span aria-hidden className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
							: <HiPlay className="h-7 w-7" aria-hidden />}
					</span>
				</div>
				<span className="mt-2 block truncate text-[13px] font-medium text-[var(--salt-white)]">{album.name}</span>
				<span className="mt-0.5 block truncate text-xs text-[var(--salt-mist)]">{album.artist}</span>
			</button>
			{state === 'error' && <p className="mt-1 text-xs text-[var(--danger)]">Could not load verified tracks. <button type="button" onClick={() => void loadAndPlay()} className="underline">Try again</button></p>}
		</article>
	);
}

function EmptyAlbums({ providers, retry }: { providers: string[]; retry: () => void }) {
	return (
		<StatusPanel
			eyebrow="Albums are temporarily empty"
			title="No provider-backed albums are available right now."
			body="The album view only shows records returned by configured music providers. No placeholder or unverified albums are inserted."
			note={providers.length > 0 ? `Unavailable or degraded: ${providers.join(', ')}` : undefined}
			actions={<StatusButton onClick={retry}>Refresh albums</StatusButton>}
		/>
	);
}

function Failure({ message, retry }: { message: string; retry: () => void }) {
	return (
		<StatusPanel
			eyebrow="Albums unavailable"
			title={message}
			tone="error"
			actions={<StatusButton onClick={retry}>Try again</StatusButton>}
		/>
	);
}

function AlbumSkeleton() {
	return (
		<section aria-label="Loading albums" className="pb-6">
			<div className="h-4 w-40 animate-pulse rounded bg-[var(--salt-ghost)]" />
			<div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
				{Array.from({ length: 12 }).map((_, i) => (
					<div key={i} className="space-y-2">
						<div className="aspect-square animate-pulse rounded-md bg-[var(--salt-ghost)]" />
						<div className="h-3 w-4/5 animate-pulse rounded bg-[var(--salt-ghost)]" />
						<div className="h-2.5 w-2/5 animate-pulse rounded bg-[var(--salt-ghost)]" />
					</div>
				))}
			</div>
			<p className="sr-only">Loading albums</p>
		</section>
	);
}
