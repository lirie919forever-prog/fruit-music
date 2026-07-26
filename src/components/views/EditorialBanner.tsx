'use client';

import { useId } from 'react';
import { HiArrowRight, HiLockClosed, HiPlay, HiPlus } from 'react-icons/hi2';
import { usePlayerStore } from '@/store/playerStore';
import { CoverArt } from '@/components/ui/CoverArt';
import type { Song } from '@/types/music';

interface EditorialBannerProps {
  song: Song;
  onQueue?: () => void;
  eyebrow: string;
  eager?: boolean;
}

export function EditorialBanner({ song, onQueue, eyebrow, eager = false }: EditorialBannerProps) {
  const headingId = useId();
  const playSong = usePlayerStore((state) => state.playSong);
  const unavailable = song.playbackUnavailable === true;
  // Generated monogram covers are square 200px placeholders. Stretched across a
  // 16:9 hero they read as a stray letter behind the title, so they stay a
  // square tile beside the text and the hero keeps its plain backdrop.
  const isGeneratedCover = !song.coverArt || song.coverArt.startsWith('data:image/');

  return (
    <article
      aria-labelledby={headingId}
      className="group relative isolate aspect-[16/11] min-h-[220px] overflow-hidden rounded-lg bg-[#193247] shadow-[0_18px_44px_rgba(15,47,68,0.18)] sm:aspect-[16/9] sm:min-h-[260px]"
    >
      {isGeneratedCover ? (
        <>
          <div className="absolute inset-0 -z-20 bg-[linear-gradient(135deg,#1d3b53,#0f2536)]" />
          <div className="pointer-events-none absolute right-4 top-4 -z-10 hidden h-24 w-24 overflow-hidden rounded-lg opacity-90 shadow-[0_10px_28px_rgba(5,17,25,0.4)] sm:block">
            <CoverArt src={song.coverArt} alt="" className="h-full w-full object-cover" loading={eager ? 'eager' : 'lazy'} sizes="96px" />
          </div>
        </>
      ) : (
        <CoverArt
          src={song.coverArt}
          alt=""
          className="absolute inset-0 -z-20 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.025]"
          loading={eager ? 'eager' : 'lazy'}
          sizes="(max-width: 1023px) 92vw, 46vw"
        />
      )}
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(5,17,25,0.08)_18%,rgba(5,17,25,0.84)_100%)]" />
      <div className="flex h-full flex-col justify-end p-4 sm:p-7">
        <p className="mb-2 text-[11px] font-semibold uppercase text-white/75">{eyebrow}</p>
        <h2 id={headingId} className="line-clamp-2 max-w-[28rem] text-xl font-bold leading-tight text-white sm:text-3xl">
          {song.title}
        </h2>
        <p className="mt-1 truncate text-sm text-white/78">{song.artist}</p>
        <div className="mt-4 flex items-center gap-2">
          {!unavailable && (
            <button
              type="button"
              onClick={() => playSong(song)}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-[#d84f5f] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#bd3f4f] focus-visible:ring-white sm:h-10"
            >
              <HiPlay className="h-4 w-4" aria-hidden />
              Play
            </button>
          )}
          {!unavailable && onQueue && (
            <button
              type="button"
              onClick={onQueue}
              aria-label={`Add ${song.title} to queue`}
              title="Add to queue"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-black/20 text-white backdrop-blur-md transition-colors hover:bg-black/35 focus-visible:ring-white sm:h-10 sm:w-10"
            >
              <HiPlus className="h-5 w-5" aria-hidden />
            </button>
          )}
          {unavailable && (
            <span className="inline-flex h-9 items-center gap-2 rounded-full border border-white/25 bg-black/25 px-3 text-xs font-semibold text-white/88 backdrop-blur-md sm:h-10 sm:px-4">
              <HiLockClosed className="h-4 w-4" aria-hidden />
              Playback unavailable
            </span>
          )}
          {song.sourceUrl && (
            <a
              href={song.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full px-2 text-xs font-semibold text-white/85 transition-colors hover:bg-white/12 hover:text-white focus-visible:ring-white sm:h-10 sm:px-3"
            >
              Source
              <HiArrowRight className="h-4 w-4" aria-hidden />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
