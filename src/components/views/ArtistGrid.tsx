'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { providerErrorMessage } from '@/lib/providers/errors';
import { catalogStaleTime, countFederatedResults } from '@/lib/catalogFreshness';
import { ArtistTile, TILE_GRID, TileSkeleton } from '@/components/ui/CatalogTile';
import { StatusButton, StatusPanel } from '@/components/ui/StatusPanel';
import type { ViewType } from '@/types/music';
import type { NavigationItem } from '@/lib/navigation';

export function ArtistGrid({
  onNavigateWithItem,
}: {
  onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void;
}) {
  const {
    data: artistState,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
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
  if (allProvidersFailed)
    return <Failure message="Artist providers are unavailable. Please try again." retry={() => void refetch()} />;
  if (!artists?.length)
    return (
      <StatusPanel
        eyebrow="Artists are temporarily empty"
        title="No provider-backed artists are available right now."
        body="Only verified artists returned by configured music providers are shown."
        note={
          unavailableProviders.length > 0 ? `Unavailable or degraded: ${unavailableProviders.join(', ')}` : undefined
        }
        actions={<StatusButton onClick={() => void refetch()}>Refresh artists</StatusButton>}
      />
    );

  return (
    <section className="pb-6">
      <div className="pb-3">
        <p className="text-[13px] text-[var(--salt-mist)]">
          {artists.length} {artists.length === 1 ? 'artist' : 'artists'}
        </p>
        {unavailableProviders.length > 0 && (
          <p className="mt-1 text-xs text-[var(--salt-mist)]">
            {unavailableProviders.join(', ')} {unavailableProviders.length === 1 ? 'is' : 'are'} unavailable. Showing
            available artists.
          </p>
        )}
      </div>
      <div className={TILE_GRID}>
        {artists.map((artist) => (
          <ArtistTile key={artist.id} artist={artist} onNavigateWithItem={onNavigateWithItem} />
        ))}
      </div>
    </section>
  );
}

function Failure({ message, retry }: { message: string; retry: () => void }) {
  return (
    <StatusPanel
      eyebrow="Artists unavailable"
      title={message}
      tone="error"
      actions={<StatusButton onClick={retry}>Try again</StatusButton>}
    />
  );
}

function ArtistSkeleton() {
  return <TileSkeleton circular />;
}
