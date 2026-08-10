'use client';

import { ArrowUpDown, CheckCircle, Info, Signal } from 'lucide-react';
import { isFullTrack } from '@/components/views/newViewModel';
import { isResolverSource } from '@/lib/sourceRegistry';
import type { Song } from '@/types/music';

export function PlaybackSourceNotice({
  catalogSong,
  effectiveSong,
  compact = false,
  mobileShort = false,
  verified = false,
}: {
  catalogSong: Song;
  effectiveSong: Song | null;
  compact?: boolean;
  /** Renders a compact, phone-sized status token while keeping a full accessible name. */
  mobileShort?: boolean;
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
        ? 'Verified full-length stream'
        : isResolverMatch
          ? 'Match pending'
          : 'Full-track source';
  const shortLabel = playbackSong.isLive
    ? 'Live'
    : !isFullTrack(playbackSong)
      ? 'Preview'
      : verified || !isResolverMatch
        ? 'Full'
        : 'Check';
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
          ? `flex min-w-0 items-center gap-1 text-[10px] leading-tight text-[var(--salt-primary)] ${mobileShort ? 'max-[359px]:hidden rounded-full border border-[rgba(32,137,193,0.2)] bg-[rgba(230,247,255,0.88)] px-1.5 py-0.5' : ''}`
          : 'flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs text-[var(--salt-primary)]'
      }
      title={
        crossSource
          ? `Selected from ${catalogSong.provider}; playback resolved via ${playbackSong.provider}`
          : `Playback source: ${playbackSong.provider}`
      }
      role="status"
      aria-label={mobileShort ? `${label} via ${playbackSong.provider}` : undefined}
    >
      {icon}
      <span className={mobileShort ? 'text-[9px] font-bold uppercase tracking-[0.04em]' : 'truncate font-semibold'}>
        {mobileShort ? shortLabel : `${label} via ${playbackSong.provider}`}
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
