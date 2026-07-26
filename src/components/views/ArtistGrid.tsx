'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePlayerStore } from '@/store/playerStore';
import { api } from '@/lib/api';
import { providerErrorMessage } from '@/lib/providers/errors';
import { catalogStaleTime, countFederatedResults } from '@/lib/catalogFreshness';
import { HiPlay } from 'react-icons/hi2';
import { CoverArt } from '@/components/ui/CoverArt';
import type { ViewType } from '@/types/music';
import type { NavigationItem } from '@/lib/navigation';
import type { Artist } from '@/types/music';

export function ArtistGrid({ onNavigateWithItem }: { onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void }) {
	const { data: artistState, isLoading, isError, error, refetch } = useQuery({
		queryKey: ['artists'],
		queryFn: ({ signal }) => api.getArtists(signal),
		staleTime: catalogStaleTime(countFederatedResults),
	});
	const artists = artistState?.results;
	const failedProviders = artistState?.failedProviders ?? [];
	const degradedProviders = artistState?.degradedProviders ?? [];
	const unavailableProviders = [...new Set([...failedProviders, ...degradedProviders])];
	const allProvidersFailed = Boolean(artistState && unavailableProviders.length === artistState.providerCount);

	if (isLoading) return <ArtistSkeleton />;
	if (isError) return <Failure message={providerErrorMessage(error)} retry={() => void refetch()} />;
	if (allProvidersFailed) return <Failure message="Artist providers are unavailable. Please try again." retry={() => void refetch()} />;
	if (!artists?.length) return (
		<div className="mx-4 my-8 rounded-[28px] border border-[var(--glass-border)] bg-[rgba(255,255,255,0.46)] px-6 py-10 text-[var(--salt-mist)] shadow-[0_16px_40px_rgba(47,119,157,0.08)] sm:mx-6">
			<p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--salt-primary)]">Artists are temporarily empty</p>
			<h2 className="mt-2 text-xl font-semibold text-[var(--salt-white)]">No provider-backed artists are available right now.</h2>
			<p className="mt-2 text-sm leading-6">Only verified artists returned by configured music providers are shown.</p>
			<button type="button" onClick={() => void refetch()} className="mt-5 rounded-full border border-[var(--glass-border-active)] px-4 py-2 text-sm text-[var(--salt-white)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]">Refresh artists</button>
		</div>
	);

	return (
		<section className="pb-6">
			<div className="pb-3">
				<p className="text-[13px] text-[var(--salt-mist)]">{artists.length} {artists.length === 1 ? 'artist' : 'artists'}</p>
				{unavailableProviders.length > 0 && <p className="mt-1 text-xs text-[var(--salt-mist)]">{unavailableProviders.join(', ')} {unavailableProviders.length === 1 ? 'is' : 'are'} unavailable. Showing available artists.</p>}
			</div>
			<div className="grid grid-cols-2 gap-x-4 gap-y-6 min-[420px]:grid-cols-3 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
				{artists.map((artist) => <ArtistCard key={artist.id} artist={artist} onNavigateWithItem={onNavigateWithItem} />)}
			</div>
		</section>
	);
}

function ArtistCard({ artist, onNavigateWithItem }: { artist: Artist; onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void }) {
	const playAlbum = usePlayerStore((state) => state.playAlbum);
	const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
	const requestRef = useRef<AbortController | null>(null);

	useEffect(() => () => requestRef.current?.abort(), []);

	const openDetail = () => {
		onNavigateWithItem?.('artists', { kind: 'artist', id: artist.id });
	};

	const loadAndPlay = async () => {
		if (state === 'loading') return;
		requestRef.current?.abort();
		const controller = new AbortController();
		requestRef.current = controller;
		setState('loading');
		try {
			const songs = await api.getArtistSongs(artist.id, controller.signal);
			if (!songs.length) throw new Error('No verified tracks are available for this artist.');
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
		<article className="min-w-0 text-center">
			<button
				type="button"
				onClick={handleClick}
				aria-label={`Open ${artist.name}`}
				className="group block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
			>
				<span className="relative block aspect-square overflow-hidden rounded-full bg-[var(--salt-ghost)]">
					<CoverArt src={artist.coverArt} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03] group-focus-visible:scale-[1.03]" />
					<span className="absolute inset-0 flex items-center justify-center bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{state === 'loading' ? <span aria-hidden className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <HiPlay className="h-6 w-6" aria-hidden />}</span>
				</span>
				<span className="mt-2 block truncate text-[13px] font-medium text-[var(--salt-white)]">{artist.name}</span>
			</button>
			{state === 'error' && <p className="mt-1 text-xs text-[var(--danger)]">Could not load tracks. <button type="button" onClick={() => void loadAndPlay()} className="rounded underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]">Try again</button></p>}
		</article>
	);
}

function Failure({ message, retry }: { message: string; retry: () => void }) {
	return <div className="flex flex-col items-start gap-3 px-4 py-10 text-[var(--salt-mist)] sm:px-6"><p>{message}</p><button type="button" onClick={retry} className="rounded-full border border-[var(--glass-border-active)] px-4 py-2 text-sm text-[var(--salt-white)]">Try again</button></div>;
}

function ArtistSkeleton() {
	return (
		<div className="grid grid-cols-2 gap-x-4 gap-y-6 min-[420px]:grid-cols-3 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
			{Array.from({ length: 12 }).map((_, i) => (
				<div key={i} className="space-y-2">
					<div className="aspect-square animate-pulse rounded-full bg-[var(--salt-ghost)]" />
					<div className="mx-auto h-3 w-2/3 animate-pulse rounded bg-[var(--salt-ghost)]" />
				</div>
			))}
		</div>
	);
}
