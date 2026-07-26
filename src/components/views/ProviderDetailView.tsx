'use client';

import { useQuery } from '@tanstack/react-query';
import { usePlayerStore } from '@/store/playerStore';
import { SongRail } from './SongCard';
import { CoverArt } from '@/components/ui/CoverArt';
import { api } from '@/lib/api';
import { providerErrorMessage } from '@/lib/providers/errors';
import { catalogStaleTime, countListResults } from '@/lib/catalogFreshness';
import type { Album, Artist, Song } from '@/types/music';

function isAlbum(item: Album | Artist): item is Album {
	return 'artist' in item && 'songCount' in item;
}

export function ProviderDetailView({ kind, id, onClose }: { kind: 'album' | 'artist'; id: string; onClose?: () => void }) {
	const playAlbum = usePlayerStore((state) => state.playAlbum);

	const metaQueryKey: readonly [string, string, string] = kind === 'album'
		? ['detail', 'album', id]
		: ['detail', 'artist', id];

	const { data: meta, isLoading: metaLoading, isError: metaError, error: metaErr, refetch: refetchMeta } = useQuery({
		queryKey: metaQueryKey,
		queryFn: ({ signal }): Promise<Album | Artist | null> =>
			kind === 'album' ? api.resolveAlbum(id, signal) : api.resolveArtist(id, signal),
		staleTime: 60_000,
		retry: 1,
	});

	const trackQueryKey: readonly [string, string] = kind === 'album'
		? ['albumSongs', id]
		: ['artistSongs', id];

	const { data: trackData, isLoading: tracksLoading, isError: tracksError, error: tracksErr, refetch: refetchTracks } = useQuery({
		queryKey: trackQueryKey,
		queryFn: ({ signal }) =>
			kind === 'album' ? api.getAlbumSongs(id, signal) : api.getArtistSongs(id, signal),
		staleTime: catalogStaleTime(countListResults),
		retry: 1,
	});

	const isLoading = metaLoading || tracksLoading;
	const songs: Song[] = trackData ?? [];
	const trackCount = songs.length;

	// Providers can serve verified tracks for a record whose summary lookup
	// failed or returned nothing. The tracks are the authoritative content, so
	// the header is derived from them rather than dropping a usable detail page.
	const derivedMeta: Album | Artist | null = songs.length === 0 ? null : kind === 'album'
		? {
			id,
			name: songs[0].album || songs[0].title,
			artist: songs[0].artist,
			artistId: songs[0].artistId,
			coverArt: songs[0].coverArt,
			songCount: songs.length,
			duration: songs.reduce((total, song) => total + song.duration, 0),
			year: songs[0].year,
			genre: songs[0].genre,
		}
		: {
			id,
			name: songs[0].artist,
			coverArt: songs[0].coverArt,
			albumCount: new Set(songs.map((song) => song.albumId)).size,
		};

	const resolvedMeta = meta ?? derivedMeta;
	const isError = (metaError && !resolvedMeta) || tracksError;
	const error = tracksError ? tracksErr : metaErr;

	const title = kind === 'album' ? 'Album' : 'Artist';

	if (isLoading) {
		return (
			<div className="pb-[88px]">
				<div className="flex items-center justify-between px-4 pt-5 sm:px-6">
					<div className="min-w-0">
						<p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--salt-mist)]">{title}</p>
						<div className="mt-2 h-8 w-48 animate-pulse rounded bg-[var(--salt-ghost)]" />
						<div className="mt-3 h-4 w-32 animate-pulse rounded bg-[var(--salt-ghost)]" />
					</div>
					<div className="h-10 w-24 animate-pulse rounded-full bg-[var(--salt-ghost)]" />
				</div>
				<div className="mt-6 grid gap-1 px-4 sm:px-6">
					{Array.from({ length: 6 }).map((_, i) => (
						<div key={i} className="h-14 animate-pulse rounded-2xl bg-[var(--salt-ghost)]" />
					))}
				</div>
			</div>
		);
	}

	if (isError || !resolvedMeta) {
		const lowerTitle = kind === 'album' ? 'album' : 'artist';
		return (
			<div className="mx-4 my-8 rounded-[28px] border border-[var(--glass-border)] bg-white/45 px-6 py-10 text-[var(--salt-mist)] shadow-[0_16px_40px_rgba(47,117,155,0.08)] sm:mx-6">
				<p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--salt-primary)]">{title} unavailable</p>
				<h2 className="mt-2 text-xl font-semibold text-[var(--salt-white)]">This {lowerTitle} could not be loaded.</h2>
				{error && <p className="mt-2 text-xs">{providerErrorMessage(error)}</p>}
				<button
					type="button"
					onClick={() => {
						void Promise.all([refetchMeta(), refetchTracks()]);
					}}
					className="mt-5 rounded-full border border-[var(--glass-border-active)] bg-white/70 px-4 py-2 text-sm text-[var(--salt-white)]"
				>
					Retry
				</button>
			</div>
		);
	}

	const subtitle = isAlbum(resolvedMeta)
		? `${resolvedMeta.artist} · ${trackCount} track${trackCount !== 1 ? 's' : ''}`
		: `${resolvedMeta.albumCount ?? 0} albums`;

	return (
		<section className="pb-[88px]">
			<div className="flex items-center justify-between gap-4 px-4 pt-5 sm:px-6">
				<div className="flex items-center gap-5">
					<div className="hidden shrink-0 sm:block">
						<div className="relative h-36 w-36 overflow-hidden rounded-[20px] bg-[var(--salt-ghost)] shadow-[0_12px_26px_rgba(47,119,157,0.14)]">
							<CoverArt src={resolvedMeta.coverArt} alt={resolvedMeta.name} loading="eager" className="h-full w-full object-cover" />
						</div>
					</div>
					<div className="min-w-0">
						<p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--salt-mist)]">{title}</p>
						<h2
							className="text-[28px] font-semibold italic text-[var(--salt-white)]"
							style={{ fontFamily: 'var(--font-display)' }}
						>
							{resolvedMeta.name}
						</h2>
						<p className="mt-1 text-xs text-[var(--salt-mist)]">{subtitle}</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					{onClose && (
						<button
							type="button"
							onClick={onClose}
							aria-label="Close"
							className="rounded-full p-2 text-[var(--salt-mist)] transition hover:bg-white/20 hover:text-[var(--salt-white)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
						>
							<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
								<path d="M4 4l12 12M16 4L4 16" />
							</svg>
						</button>
					)}
					<button
						type="button"
						onClick={() => playAlbum(songs, 0)}
						disabled={trackCount === 0}
						className="shrink-0 rounded-full bg-[var(--salt-primary)] px-5 py-2.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--salt-primary)] disabled:opacity-50"
					>
						Play All
					</button>
				</div>
			</div>

			{trackCount > 0 ? (
				<div className="mt-5 px-4 sm:px-6">
					<SongRail songs={songs} label={`${kind}:${id}`} />
				</div>
			) : (
				<div className="mx-4 mt-6 rounded-[24px] border border-dashed border-[var(--glass-border-active)] bg-white/35 p-5 sm:mx-6">
					<p className="text-sm font-medium text-[var(--salt-white)]">No verified tracks for this {kind}.</p>
					<p className="mt-1 text-xs text-[var(--salt-mist)]">The provider returned metadata but no playable tracks.</p>
				</div>
			)}
		</section>
	);
}
