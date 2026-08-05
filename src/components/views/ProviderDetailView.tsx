'use client';

import { ArrowUpDown, Play } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { usePlayerStore } from '@/store/playerStore';
import { SongRail } from './SongCard';
import { playableSongs } from './newViewModel';
import { CoverArt } from '@/components/ui/CoverArt';
import { AlbumTile } from '@/components/ui/CatalogTile';
import { StatusButton, StatusPanel } from '@/components/ui/StatusPanel';
import { VirtualGrid } from '@/components/ui/VirtualGrid';
import { providerErrorMessage } from '@/lib/providers/errors';
import { catalogStaleTime, countListResults } from '@/lib/catalogFreshness';
import type { NavigationItem } from '@/lib/navigation';
import type { Album, Artist, Song, ViewType } from '@/types/music';
import { useMusicCatalog } from '@/lib/musicCatalog';

function isAlbum(item: Album | Artist): item is Album {
  return 'artist' in item && 'songCount' in item;
}

/**
 * Shuffle starts a randomised queue rather than flipping the player's `shuffle`
 * flag: that flag governs how the *next* track is picked, so setting it would
 * still begin with track one. Fisher-Yates on a copy, so the displayed track
 * order is untouched.
 */
function shuffled(songs: Song[]): Song[] {
  const copy = [...songs];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

export function ProviderDetailView({
  kind,
  id,
  onClose,
  onNavigateWithItem,
}: {
  kind: 'album' | 'artist';
  id: string;
  onClose?: () => void;
  onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void;
}) {
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const catalog = useMusicCatalog();

  const metaQueryKey: readonly [string, string, string] =
    kind === 'album' ? ['detail', 'album', id] : ['detail', 'artist', id];

  const {
    data: meta,
    isLoading: metaLoading,
    isError: metaError,
    error: metaErr,
    refetch: refetchMeta,
  } = useQuery({
    queryKey: metaQueryKey,
    queryFn: ({ signal }): Promise<Album | Artist | null> =>
      kind === 'album' ? catalog.resolveAlbum(id, signal) : catalog.resolveArtist(id, signal),
    staleTime: 60_000,
    retry: 1,
  });

  const trackQueryKey: readonly [string, string] = kind === 'album' ? ['albumSongs', id] : ['artistSongs', id];

  const {
    data: trackData,
    isLoading: tracksLoading,
    isError: tracksError,
    error: tracksErr,
    refetch: refetchTracks,
  } = useQuery({
    queryKey: trackQueryKey,
    queryFn: ({ signal }) =>
      kind === 'album' ? catalog.getAlbumSongs(id, signal) : catalog.getArtistSongs(id, signal),
    staleTime: catalogStaleTime(countListResults),
    retry: 1,
  });

  // An artist page used to end at their top tracks, which is a chart, not a
  // discography — there was no way to reach a specific record from the person
  // who made it. Albums load independently so a provider without an album index
  // simply shows no section rather than blocking the page.
  const { data: artistAlbums } = useQuery({
    queryKey: ['artistAlbums', id],
    queryFn: ({ signal }) => catalog.getArtistAlbums(id, signal),
    enabled: kind === 'artist',
    staleTime: 60_000,
    retry: 1,
  });

  const isLoading = metaLoading || tracksLoading;
  const songs: Song[] = trackData ?? [];
  const trackCount = songs.length;
  // A known-unplayable track would only stall the queue when its turn came.
  const playableTracks = playableSongs(songs);

  // Providers can serve verified tracks for a record whose summary lookup
  // failed or returned nothing. The tracks are the authoritative content, so
  // the header is derived from them rather than dropping a usable detail page.
  const derivedMeta: Album | Artist | null =
    songs.length === 0
      ? null
      : kind === 'album'
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
      <div className="pb-6">
        <div className="flex items-start gap-4 sm:gap-6">
          <div className="h-28 w-28 shrink-0 animate-pulse rounded-md bg-[var(--salt-ghost)] sm:h-44 sm:w-44" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--salt-mist)]">{title}</p>
            <div className="mt-1.5 h-6 w-48 animate-pulse rounded bg-[var(--salt-ghost)]" />
            <div className="mt-2 h-4 w-32 animate-pulse rounded bg-[var(--salt-ghost)]" />
            <div className="mt-4 h-9 w-40 animate-pulse rounded-full bg-[var(--salt-ghost)]" />
          </div>
        </div>
        <div className="mt-6 grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex h-14 items-center gap-3 border-b border-[var(--glass-border)] px-1">
              <div className="h-10 w-10 shrink-0 animate-pulse rounded bg-[var(--salt-ghost)]" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--salt-ghost)]" />
                <div className="h-2.5 w-1/3 animate-pulse rounded bg-[var(--salt-ghost)]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError || !resolvedMeta) {
    const lowerTitle = kind === 'album' ? 'album' : 'artist';
    return (
      <StatusPanel
        eyebrow={`${title} unavailable`}
        title={`This ${lowerTitle} could not be loaded.`}
        body={error ? providerErrorMessage(error) : undefined}
        tone="error"
        actions={<StatusButton onClick={() => void Promise.all([refetchMeta(), refetchTracks()])}>Retry</StatusButton>}
      />
    );
  }

  const isResolvedAlbum = isAlbum(resolvedMeta);
  const albumMeta = isResolvedAlbum ? resolvedMeta : null;
  // The artist count comes from the loaded discography when it is there: the
  // summary's `albumCount` is a provider estimate, and reading "5 albums" above
  // a grid of eleven is worse than waiting a moment for the real number.
  const artistAlbumCount = artistAlbums?.length ?? (isResolvedAlbum ? 0 : resolvedMeta.albumCount);
  const subtitle = isResolvedAlbum
    ? `${trackCount} track${trackCount !== 1 ? 's' : ''}`
    : `${artistAlbumCount} album${artistAlbumCount !== 1 ? 's' : ''}`;

  return (
    <section className="pb-6">
      {/* Artwork left, metadata and transport stacked beside it — the shape of
			    an album page everywhere, and it keeps the title on the page surface
			    instead of over the art. */}
      <div className="flex items-start gap-4 sm:gap-6">
        <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-md bg-[var(--salt-ghost)] sm:h-44 sm:w-44">
          <CoverArt
            src={resolvedMeta.coverArt}
            alt=""
            loading="eager"
            sizes="(max-width: 640px) 112px, 176px"
            className="h-full w-full object-cover"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--salt-mist)]">{title}</p>
              <h2 className="mt-0.5 text-xl font-bold leading-tight tracking-[-0.01em] text-[var(--salt-white)] sm:text-[26px]">
                {resolvedMeta.name}
              </h2>
              {albumMeta &&
                (onNavigateWithItem ? (
                  <button
                    type="button"
                    onClick={() => onNavigateWithItem('artists', { kind: 'artist', id: albumMeta.artistId })}
                    className="mt-0.5 max-w-full truncate text-[15px] text-[var(--salt-primary)] underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current focus-visible:outline-none sm:text-[17px]"
                  >
                    {albumMeta.artist}
                  </button>
                ) : (
                  <p className="mt-0.5 truncate text-[15px] text-[var(--salt-primary)] sm:text-[17px]">
                    {albumMeta.artist}
                  </p>
                ))}
              <p className="mt-1 text-xs text-[var(--salt-mist)]">{subtitle}</p>
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 rounded-full p-1.5 text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-white)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M4 4l12 12M16 4L4 16" />
                </svg>
              </button>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2 sm:mt-4">
            <button
              type="button"
              onClick={() => playAlbum(playableTracks, 0)}
              disabled={playableTracks.length === 0}
              className="marea-primary-action inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed"
            >
              <Play className="h-3.5 w-3.5" aria-hidden />
              Play
            </button>
            <button
              type="button"
              onClick={() => playAlbum(shuffled(playableTracks), 0)}
              disabled={playableTracks.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--glass-border)] bg-white px-4 text-[13px] font-semibold text-[var(--salt-primary)] transition-colors hover:bg-[var(--glass-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowUpDown className="h-3.5 w-3.5" aria-hidden />
              Shuffle
            </button>
          </div>
        </div>
      </div>

      {trackCount > 0 ? (
        <div className="mt-6">
          {kind === 'artist' && (
            <h3 className="mb-2 text-[17px] font-bold tracking-[-0.01em] text-[var(--salt-white)]">Top songs</h3>
          )}
          <SongRail songs={songs} label={`${kind}:${id}`} onNavigateWithItem={onNavigateWithItem} />
        </div>
      ) : (
        /* Jamendo lists albums whose tracks it will not serve by album id, so
				   this state is reachable through no fault of the user. The artist
				   lookup uses a different id and does return tracks, which makes it
				   the one useful way onward instead of leaving a dead end. */
        <div className="mt-6 rounded-xl border border-[var(--glass-border)] bg-white p-5">
          <p className="text-[13px] font-medium text-[var(--salt-white)]">No verified tracks for this {kind}.</p>
          <p className="mt-1 text-xs text-[var(--salt-mist)]">The provider returned metadata but no playable tracks.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {albumMeta && onNavigateWithItem && (
              <button
                type="button"
                onClick={() => onNavigateWithItem('artists', { kind: 'artist', id: albumMeta.artistId })}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--salt-primary)] px-4 text-[13px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
              >
                Browse {albumMeta.artist}
              </button>
            )}
            <button
              type="button"
              onClick={() => void Promise.all([refetchMeta(), refetchTracks()])}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--glass-border)] px-4 text-[13px] font-semibold text-[var(--salt-primary)] transition-colors hover:bg-[var(--glass-bg-hover)]"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {kind === 'artist' && artistAlbums && artistAlbums.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 text-[17px] font-bold tracking-[-0.01em] text-[var(--salt-white)]">
            Albums <span className="font-normal text-[var(--salt-mist)]">· {artistAlbums.length}</span>
          </h3>
          <VirtualGrid
            items={artistAlbums}
            estimateRowSize={230}
            minColumnWidth={150}
            label="Artist albums"
            getItemKey={(album) => album.id}
            renderItem={(album) => <AlbumTile album={album} onNavigateWithItem={onNavigateWithItem} />}
          />
        </div>
      )}
    </section>
  );
}
