'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { providerErrorMessage } from '@/lib/providers/errors';
import { catalogStaleTime, countFederatedResults } from '@/lib/catalogFreshness';
import { AlbumTile, TILE_GRID, TileSkeleton } from '@/components/ui/CatalogTile';
import { StatusButton, StatusPanel } from '@/components/ui/StatusPanel';
import type { ViewType } from '@/types/music';
import type { NavigationItem } from '@/lib/navigation';

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
			<div className={TILE_GRID}>
				{albums.map((album) => <AlbumTile key={album.id} album={album} onNavigateWithItem={onNavigateWithItem} />)}
			</div>
		</section>
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
			<div className="mt-3"><TileSkeleton /></div>
			<p className="sr-only">Loading albums</p>
		</section>
	);
}
