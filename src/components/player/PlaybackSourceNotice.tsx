'use client';

import { ArrowUpDown, CheckCircle, Info, Signal } from 'lucide-react';
import { isFullTrack } from '@/components/views/newViewModel';
import { isResolverSource } from '@/lib/sourceRegistry';
import type { Song } from '@/types/music';

export function PlaybackSourceNotice({
  catalogSong,
  effectiveSong,
  compact = false,
  verified = false,
}: {
  catalogSong: Song;
  effectiveSong: Song | null;
  compact?: boolean;
  /** True once the audio engine has decoded a usable stream. */
  verified?: boolean;
}) {
  const playbackSong = effectiveSong ?? catalogSong;
  const isResolverMatch = isResolverSource(playbackSong.provider);
  const label = playbackSong.isLive
    ? 'Live stream'
    : !isFullTrack(playbackSong)
      ? 'Preview clip'
      : verified
        ? 'Verified full track'
        : isResolverMatch
          ? 'Match pending'
          : 'Full-track source';
  const icon = playbackSong.isLive ? (
    <Signal className="h-3.5 w-3.5 shrink-0" aria-hidden />
  ) : verified ? (
    <CheckCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
  ) : (
    <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
  );
  const crossSource = effectiveSong && effectiveSong.id !== catalogSong.id;

  return (
    <div
      className={
        compact
          ? 'flex min-w-0 items-center gap-1 text-[10px] leading-tight text-[var(--salt-primary)]'
          : 'flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs text-[var(--salt-primary)]'
      }
      title={
        crossSource
          ? `Selected from ${catalogSong.provider}; playback resolved via ${playbackSong.provider}`
          : `Playback source: ${playbackSong.provider}`
      }
      role="status"
    >
      {icon}
      <span className="truncate font-semibold">
        {label} via {playbackSong.provider}
      </span>
      {!compact && crossSource && (
        <>
          <ArrowUpDown className="h-3 w-3 shrink-0 text-[var(--salt-mist)]" aria-hidden />
          <span className="truncate text-[var(--salt-mist)]">picked from {catalogSong.provider}</span>
        </>
      )}
    </div>
  );
}
