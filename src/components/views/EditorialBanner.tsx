'use client';

import { ExternalLink, Lock, Play, Plus } from 'lucide-react';
import { useId } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { CoverArt } from '@/components/ui/CoverArt';
import { FavoriteButton } from './SongCard';
import type { NavigationItem } from '@/lib/navigation';
import type { Song, ViewType } from '@/types/music';

interface EditorialBannerProps {
  song: Song;
  onQueue?: () => void;
  eyebrow: string;
  eager?: boolean;
  onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void;
}

/**
 * The spotlight lockup: square artwork beside its metadata.
 *
 * Deliberately not the 16:9 photographic hero a commercial service uses. Every
 * provider here returns square cover art at 200-500px, so a 16:9 slot can only
 * be filled by upscaling it into a blur, and text laid over that needs a scrim
 * heavy enough to bury the artwork it is supposed to be selling. Artwork at its
 * own aspect ratio with the text beside it stays sharp and legible whatever the
 * source supplies — including the generated monogram tiles.
 */
export function EditorialBanner({ song, onQueue, eyebrow, eager = false, onNavigateWithItem }: EditorialBannerProps) {
  const headingId = useId();
  const playSong = usePlayerStore((state) => state.playSong);
  const unavailable = song.playbackUnavailable === true;
  const openAlbum =
    onNavigateWithItem && song.albumId
      ? () => onNavigateWithItem('albums', { kind: 'album', id: song.albumId })
      : undefined;

  return (
    <article
      aria-labelledby={headingId}
      className="marea-glass-card group flex h-full items-center gap-4 rounded-xl border p-3 transition-shadow sm:gap-5 sm:p-4"
    >
      {openAlbum ? (
        <button
          type="button"
          onClick={openAlbum}
          aria-label={`Open ${song.album || song.title}`}
          className="shrink-0 overflow-hidden rounded-lg bg-[var(--salt-ghost)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
        >
          <CoverArt
            src={song.coverArt}
            alt=""
            loading={eager ? 'eager' : 'lazy'}
            sizes="(max-width: 640px) 96px, 152px"
            className="h-24 w-24 object-cover transition-transform duration-500 group-hover:scale-[1.03] sm:h-[152px] sm:w-[152px]"
          />
        </button>
      ) : (
        <span className="shrink-0 overflow-hidden rounded-lg bg-[var(--salt-ghost)]">
          <CoverArt
            src={song.coverArt}
            alt=""
            loading={eager ? 'eager' : 'lazy'}
            sizes="(max-width: 640px) 96px, 152px"
            className="h-24 w-24 object-cover sm:h-[152px] sm:w-[152px]"
          />
        </span>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#bd3f4f]">{eyebrow}</p>
        <h3
          id={headingId}
          className="mt-1 line-clamp-2 text-[17px] font-semibold leading-snug text-[var(--salt-white)] sm:text-xl"
        >
          {song.title}
        </h3>
        {onNavigateWithItem ? (
          <button
            type="button"
            onClick={() => onNavigateWithItem('artists', { kind: 'artist', id: song.artistId })}
            aria-label={`Open ${song.artist}`}
            className="mt-0.5 max-w-full truncate text-left text-[13px] text-[var(--salt-mist)] underline decoration-transparent underline-offset-2 transition-colors hover:text-[var(--salt-primary)] hover:decoration-current focus-visible:text-[var(--salt-primary)] focus-visible:outline-none sm:text-[15px]"
          >
            {song.artist}
          </button>
        ) : (
          <p className="mt-0.5 truncate text-[13px] text-[var(--salt-mist)] sm:text-[15px]">{song.artist}</p>
        )}

        <div className="mt-3 flex items-center gap-1.5 sm:mt-4 sm:gap-2">
          {unavailable ? (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--salt-ghost)] px-3 text-[11px] font-semibold text-[var(--salt-mist)] sm:h-9 sm:text-xs">
              <Lock className="h-3.5 w-3.5" aria-hidden />
              Playback unavailable
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => playSong(song)}
                className="marea-primary-action inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold text-white sm:h-9 sm:px-4"
              >
                <Play className="h-3.5 w-3.5" aria-hidden />
                Play
              </button>
              {onQueue && (
                <button
                  type="button"
                  onClick={onQueue}
                  aria-label={`Add ${song.title} to queue`}
                  title="Add to queue"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-white)] sm:h-9 sm:w-9"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </button>
              )}
            </>
          )}
          <FavoriteButton song={song} className="sm:h-9 sm:w-9" />
          {song.sourceUrl && (
            <a
              href={song.sourceUrl}
              target="_blank"
              rel="noreferrer"
              title={`${song.provider} · ${song.licenseName || 'Provider terms'}`}
              aria-label={`Open on ${song.provider}`}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-white)] sm:h-9 sm:w-9"
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
