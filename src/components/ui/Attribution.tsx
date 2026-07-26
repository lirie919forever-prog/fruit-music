'use client';

import type { Song } from '@/types/music';

export function Attribution({ song, compact = false }: { song: Song; compact?: boolean }) {
  return (
    <span
      className={
        compact
          ? 'flex min-w-0 max-w-full items-center gap-1 overflow-hidden text-[10px] text-[var(--salt-mist)]'
          : 'flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-[var(--salt-mist)]'
      }
    >
      {song.sourceUrl ? (
        <a
          href={song.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate underline decoration-transparent underline-offset-2 transition-colors hover:text-[var(--salt-primary)] hover:decoration-current focus-visible:text-[var(--salt-primary)]"
        >
          {song.provider}
        </a>
      ) : (
        <span className="truncate">{song.provider}</span>
      )}
      <span aria-hidden>·</span>
      {song.creatorUrl ? (
        <a
          href={song.creatorUrl}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate underline decoration-transparent underline-offset-2 transition-colors hover:text-[var(--salt-primary)] hover:decoration-current focus-visible:text-[var(--salt-primary)]"
        >
          {song.artist}
        </a>
      ) : (
        <span className="truncate">{song.artist}</span>
      )}
      <span aria-hidden>·</span>
      {song.licenseUrl ? (
        <a
          href={song.licenseUrl}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate underline decoration-transparent underline-offset-2 transition-colors hover:text-[var(--salt-primary)] hover:decoration-current focus-visible:text-[var(--salt-primary)]"
        >
          {song.licenseName}
        </a>
      ) : (
        <span className="truncate">{song.licenseName || 'Provider terms apply'}</span>
      )}
    </span>
  );
}
