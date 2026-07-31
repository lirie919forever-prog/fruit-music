'use client';

import { useId } from 'react';
import { motion, type Variants } from 'motion/react';
import { HiArrowTopRightOnSquare, HiLockClosed, HiPlay, HiPlus } from 'react-icons/hi2';
import { usePlayerStore } from '@/store/playerStore';
import { CoverArt } from '@/components/ui/CoverArt';
import { FavoriteButton } from './SongCard';
import type { NavigationItem } from '@/lib/navigation';
import type { Song, ViewType } from '@/types/music';

interface CinematicHeroProps {
  song: Song;
  eyebrow: string;
  onQueue?: () => void;
  onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void;
}

// The spotlight lockup scaled up to a full-width photographic hero. The cover
// art drives the colour field: it renders once sharp (the real artwork) and once
// behind everything through `.ambient-artwork` (globals.css) — the existing
// blur-and-multiply wash the now-playing view uses — so the hero's gradient is
// genuinely derived from the art, not a fixed tint. The text sits over a scrim
// heavy enough that any cover stays legible.
const HERO_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 16 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};

export function CinematicHero({ song, eyebrow, onQueue, onNavigateWithItem }: CinematicHeroProps) {
  const headingId = useId();
  const playSong = usePlayerStore((state) => state.playSong);
  const unavailable = song.playbackUnavailable === true;
  const openAlbum =
    onNavigateWithItem && song.albumId
      ? () => onNavigateWithItem('albums', { kind: 'album', id: song.albumId })
      : undefined;

  const cover = (
    <CoverArt
      src={song.coverArt}
      alt=""
      loading="eager"
      sizes="(max-width: 640px) 112px, 160px"
      className="h-24 w-24 shrink-0 rounded-xl object-cover shadow-[0_8px_28px_rgba(16,47,69,0.22)] sm:h-32 sm:w-32 lg:h-36 lg:w-36"
    />
  );

  return (
    <motion.article
      variants={HERO_VARIANTS}
      aria-labelledby={headingId}
      className="group relative isolate flex min-h-[220px] flex-col justify-between overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--sea-abyss)] p-5 shadow-[0_12px_40px_rgba(16,47,69,0.12)] sm:min-h-[280px] sm:p-7 lg:min-h-[320px] lg:p-8"
    >
      {/* Dynamic cover-colour field: the blurred, saturated cover art bleed. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <CoverArt src={song.coverArt} alt="" aria-hidden className="ambient-artwork" />
        {/* A darker scrim than the near-white browse base so the white and ink
            text both stay legible over any cover, without burying the colour. */}
        <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(16,47,69,0.62),rgba(16,47,69,0.32)_52%,rgba(16,47,69,0.12))]" />
      </div>

      <div className="flex flex-1 items-center gap-5 sm:gap-6">
        {openAlbum ? (
          <button
            type="button"
            onClick={openAlbum}
            aria-label={`Open ${song.album || song.title}`}
            className="shrink-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            {cover}
          </button>
        ) : (
          <span className="shrink-0">{cover}</span>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/85">{eyebrow}</p>
          <h3
            id={headingId}
            className="mt-1.5 line-clamp-2 font-headline text-[24px] font-semibold leading-[1.05] tracking-[-0.02em] text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)] sm:text-[30px] lg:text-[34px]"
          >
            {song.title}
          </h3>
          {onNavigateWithItem ? (
            <button
              type="button"
              onClick={() => onNavigateWithItem('artists', { kind: 'artist', id: song.artistId })}
              aria-label={`Open ${song.artist}`}
              className="mt-1 max-w-full truncate text-left text-[13px] text-white/85 underline decoration-white/30 underline-offset-2 transition-colors hover:text-white hover:decoration-current focus-visible:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:text-[15px]"
            >
              {song.artist}
            </button>
          ) : (
            <p className="mt-1 truncate text-[13px] text-white/85 sm:text-[15px]">{song.artist}</p>
          )}
          {song.album && (
            <p className="mt-0.5 truncate text-xs text-white/65">{song.album}</p>
          )}
        </div>
      </div>

      <div className="mt-5 flex items-center gap-1.5 sm:mt-7 sm:gap-2">
        {unavailable ? (
          <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/15 px-3.5 text-xs font-semibold text-white backdrop-blur-sm sm:h-10 sm:px-4">
            <HiLockClosed className="h-3.5 w-3.5" aria-hidden />
            Playback unavailable
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => playSong(song)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#d84f5f] px-4 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(216,79,95,0.4)] transition-colors hover:bg-[#bd3f4f] sm:h-10 sm:px-5 sm:text-sm"
            >
              <HiPlay className="h-4 w-4" aria-hidden />
              Play
            </button>
            {onQueue && (
              <button
                type="button"
                onClick={onQueue}
                aria-label={`Add ${song.title} to queue`}
                title="Add to queue"
                className="flex h-9 w-9 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 hover:text-white sm:h-10 sm:w-10"
              >
                <HiPlus className="h-4 w-4" aria-hidden />
              </button>
            )}
          </>
        )}
        <FavoriteButton song={song} className="sm:h-10 sm:w-10 text-white/85 [&]:hover:bg-white/15" />
        {song.sourceUrl && (
          <a
            href={song.sourceUrl}
            target="_blank"
            rel="noreferrer"
            title={`${song.provider} · ${song.licenseName || 'Provider terms'}`}
            aria-label={`Open on ${song.provider}`}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 hover:text-white sm:h-10 sm:w-10"
          >
            <HiArrowTopRightOnSquare className="h-4 w-4" aria-hidden />
          </a>
        )}
      </div>
    </motion.article>
  );
}
