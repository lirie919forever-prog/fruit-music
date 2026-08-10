'use client';

import { Heart, Lock, Play } from 'lucide-react';
import type { ReactNode } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { CoverArt } from '@/components/ui/CoverArt';
import { TrackMenu } from '@/components/ui/TrackMenu';
import { VirtualList } from '@/components/ui/VirtualList';
import { isResolverSource } from '@/lib/sourceRegistry';
import { isFullTrack, playableSongs, selectionQueue } from './newViewModel';
import type { NavigationItem } from '@/lib/navigation';
import type { Song, ViewType } from '@/types/music';

export interface TrackNavProps {
  onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void;
}

interface SongCardProps extends TrackNavProps {
  song: Song;
  index: number;
  tracks: Song[];
  showIndex?: boolean;
  /** Controls that only make sense in one list, e.g. playlist reordering. */
  trailing?: ReactNode;
}

export function FavoriteButton({ song, className = '' }: { song: Song; className?: string }) {
  const favorites = usePlayerStore((state) => state.favorites);
  const toggleFavorite = usePlayerStore((state) => state.toggleFavorite);
  const favorite = favorites.some((item) => item.id === song.id);

  return (
    <button
      type="button"
      onClick={() => toggleFavorite(song)}
      aria-label={`${favorite ? 'Remove' : 'Add'} ${song.title} ${favorite ? 'from' : 'to'} favorites`}
      aria-pressed={favorite}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base leading-none transition hover:bg-[var(--glass-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] lg:h-8 lg:w-8 ${favorite ? 'text-[#d84f5f]' : 'text-[var(--salt-mist)]'} ${className}`}
    >
      {favorite ? <Heart className="h-4 w-4 fill-current" aria-hidden /> : <Heart className="h-4 w-4" aria-hidden />}
    </button>
  );
}

export function AudioAccessBadge({ song }: { song: Song }) {
  const live = song.isLive === true;
  const unavailable = song.playbackUnavailable === true;
  const resolverMatch = isResolverSource(song.provider);
  const full = isFullTrack(song);
  const label = unavailable ? 'OFFLINE' : live ? 'LIVE' : !full ? 'PREVIEW' : resolverMatch ? 'VERIFY' : 'FULL';
  const title = unavailable
    ? 'Playback is unavailable for this source'
    : live
      ? 'Continuous live stream'
      : !full
        ? 'Official preview clip'
        : resolverMatch
          ? 'Catalog match; stream availability is checked before playback'
          : 'Direct full-length source';
  return (
    <span
      title={title}
      className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-[0.04em] ${
        unavailable
          ? 'bg-[#f3f5f6] text-[var(--salt-mist)]'
          : live
            ? 'bg-[#d84f5f] text-white'
            : !full || resolverMatch
              ? 'bg-[#fff1e4] text-[#9b5d20]'
              : 'bg-[#e8f5ee] text-[#28764a]'
      }`}
    >
      {label}
    </span>
  );
}

export function ArtistLink({
  song,
  onNavigateWithItem,
  className = '',
}: TrackNavProps & { song: Song; className?: string }) {
  if (!onNavigateWithItem) return <span className={className}>{song.artist}</span>;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onNavigateWithItem('artists', { kind: 'artist', id: song.artistId });
      }}
      aria-label={`Open ${song.artist}`}
      className={`min-w-0 max-w-full truncate text-left underline decoration-transparent underline-offset-2 transition-colors hover:text-[var(--salt-primary)] hover:decoration-current focus-visible:text-[var(--salt-primary)] focus-visible:outline-none ${className}`}
    >
      {song.artist}
    </button>
  );
}

/**
 * Artwork that doubles as the play control. The play glyph only appears on
 * hover/focus so a dense list is artwork and text at rest, the way a browse
 * page should read — but it is a real button, so keyboard and touch both reach
 * it without depending on hover.
 */
function ArtworkPlayButton({
  song,
  onPlay,
  unavailable,
  size = 'h-10 w-10',
  eager = false,
}: {
  song: Song;
  onPlay: () => void;
  unavailable: boolean;
  size?: string;
  eager?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPlay}
      disabled={unavailable}
      aria-label={unavailable ? `${song.title} is unavailable for playback` : `Play ${song.title} by ${song.artist}`}
      className={`group/art relative shrink-0 overflow-hidden rounded bg-[var(--salt-ghost)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] disabled:cursor-not-allowed ${size}`}
    >
      <CoverArt
        src={song.coverArt}
        alt=""
        loading={eager ? 'eager' : 'lazy'}
        sizes="40px"
        className="h-full w-full object-cover"
      />
      <span
        aria-hidden
        className={`absolute inset-0 flex items-center justify-center bg-black/45 text-white transition-opacity ${unavailable ? 'opacity-0' : 'opacity-0 group-hover/art:opacity-100 group-focus-visible/art:opacity-100'}`}
      >
        <Play className="h-4 w-4" />
      </span>
    </button>
  );
}

export function SongCard({ song, index, tracks, showIndex = true, trailing, onNavigateWithItem }: SongCardProps) {
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const currentSong = usePlayerStore((state) => state.currentSong);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const isActive = currentSong?.id === song.id;
  const playbackUnavailable = song.playbackUnavailable === true;
  // A known-unplayable sibling must never enter the queue: it would only
  // stall playback when its turn comes around.
  const playableTracks = playableSongs(tracks);
  const playTracks = selectionQueue(song, playableTracks);
  const playableIndex = playTracks.findIndex((track) => track.id === song.id);
  const play = () => {
    if (!playbackUnavailable) playAlbum(playTracks, playableIndex);
  };

  return (
    <article
      className={`flex h-14 items-center gap-3 border-b border-[var(--glass-border)] px-1 transition-colors last:border-b-0 ${isActive ? 'bg-[color-mix(in_srgb,var(--salt-primary)_7%,white)]' : 'hover:bg-[var(--glass-bg-hover)]'}`}
      aria-current={isActive ? 'true' : undefined}
    >
      {showIndex && (
        <span
          className="hidden w-6 shrink-0 text-center text-[13px] tabular-nums text-[var(--salt-mist)] sm:block"
          aria-label={`Track ${index + 1}`}
        >
          {isActive && isPlaying ? <EqualizerGlyph /> : index + 1}
        </span>
      )}
      <ArtworkPlayButton song={song} onPlay={play} unavailable={playbackUnavailable} eager={index < 2} />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={play}
          disabled={playbackUnavailable}
          aria-label={
            playbackUnavailable ? `${song.title} is unavailable for playback` : `Play ${song.title} by ${song.artist}`
          }
          className="block max-w-full truncate text-left text-[13px] font-medium leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] disabled:cursor-not-allowed"
          style={{ color: isActive ? 'var(--salt-primary)' : 'var(--salt-white)' }}
        >
          {song.title}
        </button>
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs leading-tight text-[var(--salt-mist)]">
          <ArtistLink song={song} onNavigateWithItem={onNavigateWithItem} className="text-xs" />
          <span aria-hidden className="shrink-0">
            ·
          </span>
          <span className="shrink-0 truncate">{song.provider}</span>
          <AudioAccessBadge song={song} />
        </span>
      </div>
      {playbackUnavailable && (
        <span
          title="Playback unavailable"
          aria-label="Playback unavailable"
          className="shrink-0 text-[var(--salt-mist)]"
        >
          <Lock className="h-3.5 w-3.5" aria-hidden />
        </span>
      )}
      <span className="hidden w-10 shrink-0 text-right text-xs tabular-nums text-[var(--salt-mist)] sm:block">
        {song.isLive ? 'LIVE' : formatDuration(song.duration)}
      </span>
      <TrackMenu song={song} onNavigateWithItem={onNavigateWithItem} />
      {trailing}
    </article>
  );
}

function EqualizerGlyph() {
  return (
    <span aria-label="Now playing" className="inline-flex h-3 items-end justify-center gap-[2px] align-middle">
      <span className="eq-bar-1 block h-full w-[2px] origin-bottom rounded-full bg-[var(--salt-primary)]" />
      <span className="eq-bar-2 block h-full w-[2px] origin-bottom rounded-full bg-[var(--salt-primary)]" />
      <span className="eq-bar-3 block h-full w-[2px] origin-bottom rounded-full bg-[var(--salt-primary)]" />
    </span>
  );
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function SongRail({
  songs,
  label,
  showIndex = true,
  onNavigateWithItem,
}: { songs: Song[]; label: string; showIndex?: boolean } & TrackNavProps) {
  return (
    <VirtualList
      items={songs}
      estimateSize={56}
      label={label}
      getItemKey={(song) => song.id}
      className="border-y border-[var(--glass-border)]"
      renderItem={(song, index) => (
        <SongCard
          song={song}
          index={index}
          tracks={songs}
          showIndex={showIndex}
          onNavigateWithItem={onNavigateWithItem}
        />
      )}
    />
  );
}

function ChartRow({
  song,
  rank,
  tracks,
  onNavigateWithItem,
}: { song: Song; rank: number; tracks: Song[] } & TrackNavProps) {
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const currentSong = usePlayerStore((state) => state.currentSong);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const isActive = currentSong?.id === song.id;
  const unavailable = song.playbackUnavailable === true;
  const playableTracks = playableSongs(tracks);
  const playTracks = selectionQueue(song, playableTracks);
  const playableIndex = playTracks.findIndex((track) => track.id === song.id);

  return (
    <article
      className={`flex h-14 items-center gap-3 border-b border-[var(--glass-border)] px-1 transition-colors last:border-b-0 ${isActive ? 'bg-[color-mix(in_srgb,var(--salt-primary)_7%,white)]' : 'hover:bg-[var(--glass-bg-hover)]'}`}
      aria-current={isActive ? 'true' : undefined}
    >
      <span
        className={`w-6 shrink-0 text-center text-[15px] font-semibold tabular-nums ${isActive && isPlaying ? 'text-[var(--salt-primary)]' : 'text-[var(--salt-mist)]'}`}
        aria-label={`Rank ${rank}`}
      >
        {isActive && isPlaying ? <EqualizerGlyph /> : rank}
      </span>
      <ArtworkPlayButton
        song={song}
        onPlay={() => playAlbum(playTracks, playableIndex)}
        unavailable={unavailable}
        eager={rank === 1}
      />
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-[13px] font-medium leading-tight ${isActive ? 'text-[var(--salt-primary)]' : 'text-[var(--salt-white)]'}`}
        >
          {song.title}
        </p>
        <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs leading-tight text-[var(--salt-mist)]">
          <ArtistLink
            song={song}
            onNavigateWithItem={onNavigateWithItem}
            className="min-w-0 flex-1 text-xs text-[var(--salt-mist)]"
          />
          <AudioAccessBadge song={song} />
          <span className="shrink-0 text-[11px] tabular-nums text-[var(--salt-mist)]">
            {song.isLive ? 'LIVE' : formatDuration(song.duration)}
          </span>
        </div>
      </div>
      {unavailable && (
        <span
          title="This track's streaming source isn't available right now"
          aria-label="Streaming unavailable"
          className="shrink-0 text-[var(--salt-mist)]"
        >
          <Lock className="h-3.5 w-3.5" aria-hidden />
        </span>
      )}
      <TrackMenu song={song} onNavigateWithItem={onNavigateWithItem} />
    </article>
  );
}

export function ChartRail({ songs, label, onNavigateWithItem }: { songs: Song[]; label: string } & TrackNavProps) {
  // Two columns filled top-to-bottom rather than left-to-right: in a ranked
  // list, reading order is the rank order, so 1-3 belong in the left column and
  // 4-6 in the right. Row-major would scatter them 1,2,3 across the page.
  // Below `md` there is one column and the explicit rows simply overflow into
  // implicit ones, which stacks all entries in order.
  const rows = Math.max(1, Math.ceil(songs.length / 2));
  return (
    <div
      aria-label={label}
      className="grid gap-x-8 md:grid-flow-col md:grid-cols-2"
      style={{ gridTemplateRows: `repeat(${rows}, auto)` }}
    >
      {songs.map((song, index) => (
        <ChartRow key={song.id} song={song} rank={index + 1} tracks={songs} onNavigateWithItem={onNavigateWithItem} />
      ))}
    </div>
  );
}
