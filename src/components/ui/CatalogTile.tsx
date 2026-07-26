'use client';

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { HiPlay } from 'react-icons/hi2';
import { usePlayerStore } from '@/store/playerStore';
import { api } from '@/lib/api';
import { CoverArt } from '@/components/ui/CoverArt';
import type { NavigationItem } from '@/lib/navigation';
import type { Album, Artist, ViewType } from '@/types/music';

/**
 * The one album/artist tile.
 *
 * The albums grid and the artists grid had each grown their own copy of this —
 * same load-and-play logic, same modifier-click shortcut, same error line,
 * differing only in whether the artwork is a square or a circle. Search results
 * and an artist's discography need the same tile again, and a fourth and fifth
 * copy is how the two existing ones would drift apart for good.
 */

export interface TileNavProps {
  onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void;
}

type LoadState = 'idle' | 'loading' | 'error';

function useLoadAndPlay(loadSongs: (signal: AbortSignal) => Promise<import('@/types/music').Song[]>) {
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const [state, setState] = useState<LoadState>('idle');
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  const run = async () => {
    if (state === 'loading') return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState('loading');
    try {
      const songs = await loadSongs(controller.signal);
      if (!songs.length) throw new Error('No playable tracks are available.');
      playAlbum(songs, 0);
      setState('idle');
    } catch {
      if (!controller.signal.aborted) setState('error');
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  return { state, run };
}

function TileShell({
  label,
  rounded,
  coverArt,
  loading,
  onClick,
  children,
  retry,
  errorText,
  centered,
}: {
  label: string;
  rounded: string;
  coverArt: string;
  loading: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  retry: () => void;
  errorText: string | null;
  centered?: boolean;
}) {
  return (
    <article className={`min-w-0 ${centered ? 'text-center' : ''}`}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="group block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
      >
        <span className={`relative block aspect-square overflow-hidden bg-[var(--salt-ghost)] ${rounded}`}>
          <CoverArt
            src={coverArt}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03] group-focus-visible:scale-[1.03]"
          />
          <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            {loading ? (
              <span
                aria-hidden
                className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            ) : (
              <HiPlay className="h-7 w-7" aria-hidden />
            )}
          </span>
        </span>
        {children}
      </button>
      {errorText && (
        <p className="mt-1 text-xs text-[var(--danger)]">
          {errorText}{' '}
          <button
            type="button"
            onClick={retry}
            className="rounded underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
          >
            Try again
          </button>
        </p>
      )}
    </article>
  );
}

export function AlbumTile({ album, onNavigateWithItem }: { album: Album } & TileNavProps) {
  const { state, run } = useLoadAndPlay((signal) => api.getAlbumSongs(album.id, signal));

  // A modifier-click plays the record without leaving the grid; a plain click
  // opens it, which is what a tile in a browse grid is expected to do.
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
      void run();
      return;
    }
    onNavigateWithItem?.('albums', { kind: 'album', id: album.id });
  };

  return (
    <TileShell
      label={`Open ${album.name} by ${album.artist}`}
      rounded="rounded-md"
      coverArt={album.coverArt}
      loading={state === 'loading'}
      onClick={handleClick}
      retry={() => void run()}
      errorText={state === 'error' ? 'Could not load tracks.' : null}
    >
      <span className="mt-2 block truncate text-[13px] font-medium text-[var(--salt-white)]">{album.name}</span>
      <span className="mt-0.5 block truncate text-xs text-[var(--salt-mist)]">{album.artist}</span>
    </TileShell>
  );
}

export function ArtistTile({ artist, onNavigateWithItem }: { artist: Artist } & TileNavProps) {
  const { state, run } = useLoadAndPlay((signal) => api.getArtistSongs(artist.id, signal));

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
      void run();
      return;
    }
    onNavigateWithItem?.('artists', { kind: 'artist', id: artist.id });
  };

  return (
    <TileShell
      label={`Open ${artist.name}`}
      rounded="rounded-full"
      coverArt={artist.coverArt}
      loading={state === 'loading'}
      onClick={handleClick}
      retry={() => void run()}
      errorText={state === 'error' ? 'Could not load tracks.' : null}
      centered
    >
      <span className="mt-2 block truncate text-center text-[13px] font-medium text-[var(--salt-white)]">
        {artist.name}
      </span>
    </TileShell>
  );
}

/** The grid every tile row uses, so column counts never diverge between views. */
export const TILE_GRID =
  'grid grid-cols-2 gap-x-4 gap-y-6 min-[420px]:grid-cols-3 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6';

export function TileSkeleton({ count = 12, circular = false }: { count?: number; circular?: boolean }) {
  return (
    <div className={TILE_GRID}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="space-y-2">
          <div
            className={`aspect-square animate-pulse bg-[var(--salt-ghost)] ${circular ? 'rounded-full' : 'rounded-md'}`}
          />
          <div className={`h-3 animate-pulse rounded bg-[var(--salt-ghost)] ${circular ? 'mx-auto w-2/3' : 'w-3/4'}`} />
        </div>
      ))}
    </div>
  );
}
