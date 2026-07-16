'use client';

import type { Song } from '@/types/music';

export function Attribution({ song, compact = false }: { song: Song; compact?: boolean }) {
  return (
    <span className={compact ? 'flex min-w-0 items-center gap-1 text-[10px] text-[var(--salt-mist)]' : 'flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-[var(--salt-mist)]'}>
      <a href={song.sourceUrl} target="_blank" rel="noreferrer" className="truncate underline decoration-transparent underline-offset-2 hover:decoration-current">
        {song.provider}
      </a>
      <span aria-hidden>·</span>
      {song.creatorUrl ? (
        <a href={song.creatorUrl} target="_blank" rel="noreferrer" className="truncate underline decoration-transparent underline-offset-2 hover:decoration-current">{song.artist}</a>
      ) : <span className="truncate">{song.artist}</span>}
      <span aria-hidden>·</span>
      <a href={song.licenseUrl} target="_blank" rel="noreferrer" className="shrink-0 underline decoration-transparent underline-offset-2 hover:decoration-current">{song.licenseName}</a>
    </span>
  );
}
