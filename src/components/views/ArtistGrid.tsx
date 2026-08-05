'use client';

import { useQuery } from '@tanstack/react-query';
import { providerErrorMessage } from '@/lib/providers/errors';
import { catalogStaleTime, countFederatedResults } from '@/lib/catalogFreshness';
import { ArtistTile, TileSkeleton } from '@/components/ui/CatalogTile';
import { StatusButton, StatusPanel } from '@/components/ui/StatusPanel';
import { VirtualGrid } from '@/components/ui/VirtualGrid';
import type { ViewType } from '@/types/music';
import type { NavigationItem } from '@/lib/navigation';
import { useMusicCatalog } from '@/lib/musicCatalog';

export function ArtistGrid({
  onNavigateWithItem,
}: {
  onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void;
}) {
  const catalog = useMusicCatalog();
  const {
    data: artistState,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['artists'],
    queryFn: ({ signal }) => catalog.getArtists(signal),
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
      <VirtualGrid
        items={artists}
        estimateRowSize={230}
        minColumnWidth={150}
        label="Artists"
        getItemKey={(artist) => artist.id}
        renderItem={(artist) => <ArtistTile artist={artist} onNavigateWithItem={onNavigateWithItem} />}
      />
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
