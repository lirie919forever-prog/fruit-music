'use client';

import { usePlayerStore } from '@/store/playerStore';
import { CoverArt } from '@/components/ui/CoverArt';
import { Attribution } from '@/components/ui/Attribution';
import type { Song } from '@/types/music';

interface SongCardProps {
  song: Song;
  index: number;
  tracks: Song[];
  showExplicit?: boolean;
}

export function SongCard({ song, index, tracks, showExplicit = true }: SongCardProps) {
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const addToQueue = usePlayerStore((state) => state.addToQueue);
  const currentSong = usePlayerStore((state) => state.currentSong);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const isActive = currentSong?.id === song.id;
  const playbackUnavailable = song.playbackUnavailable === true;

  return (
    <article
      className={`grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 rounded-2xl px-3 py-2 transition duration-150 sm:grid-cols-[32px_44px_minmax(0,1fr)_56px_76px] ${isActive ? 'bg-[color-mix(in_srgb,var(--salt-primary)_10%,white)]' : 'hover:bg-[var(--glass-bg-hover)]'}`}
      aria-current={isActive ? 'true' : undefined}
    >
      <span className="hidden text-center text-xs tabular-nums text-[var(--salt-mist)] sm:block" aria-label={`Track ${index + 1}`}>
        {isActive && isPlaying ? '▶' : index + 1}
      </span>
      <div className="col-span-2 flex min-w-0 items-center gap-3 sm:col-span-2">
        <button
          type="button"
          onClick={() => { if (!playbackUnavailable) playAlbum(tracks, index); }}
          aria-label={playbackUnavailable ? `${song.title} playback unavailable` : `Play ${song.title}`}
          disabled={playbackUnavailable}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CoverArt src={song.coverArt} alt={song.album} loading="lazy" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
          <span className="min-w-0">
            <span className={`block truncate text-sm font-medium ${isActive ? 'text-[var(--salt-primary)]' : 'text-[var(--salt-white)]'}`}>{song.title}</span>
            <span className="block truncate text-xs text-[var(--salt-mist)]">{song.artist}{song.album ? ` · ${song.album}` : ''}</span>
          </span>
        </button>
        <span className="hidden min-w-0 sm:block"><Attribution song={song} compact /></span>
        {playbackUnavailable && <span className="text-[10px] text-[var(--danger)] sm:hidden">Unavailable</span>}
      </div>
      <span className="hidden text-right text-xs tabular-nums text-[var(--salt-mist)] sm:block">{formatDuration(song.duration)}</span>
      <div className="flex items-center justify-end gap-1">
        {showExplicit && <ExplicitBadge song={song} />}
        <button
          type="button"
          onClick={() => addToQueue(song)}
          aria-label={`Add ${song.title} to queue`}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--glass-border)] bg-white/60 text-[var(--salt-primary)] shadow-sm transition hover:bg-[var(--glass-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z" /></svg>
        </button>
        <button
          type="button"
          onClick={() => { if (!playbackUnavailable) playAlbum(tracks, index); }}
          aria-label={`Play ${song.title}`}
          disabled={playbackUnavailable}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[linear-gradient(145deg,#2494ce,#0d73ae)] text-white shadow-[0_5px_14px_rgba(25,126,184,0.2)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
        </button>
      </div>
    </article>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function ExplicitBadge({ song }: { song: Song }) {
  const isExplicit = /explicit/i.test(song.title) || /\(explicit\)/i.test(song.title);
  if (!isExplicit) return null;
  return <span className="hidden text-[10px] font-bold text-[var(--salt-foam)] sm:inline" aria-label="Explicit">E</span>;
}

export function SongRail({ songs, label }: { songs: Song[]; label: string }) {
  return (
    <div className="grid gap-0.5 rounded-[24px] border border-[var(--glass-border)] bg-[rgba(255,255,255,0.52)] shadow-[0_12px_32px_rgba(47,117,155,0.06)]">
      {songs.map((song, index) => (
        <SongCard key={song.id} song={song} index={index} tracks={songs} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

function ChartRow({ song, rank, tracks }: { song: Song; rank: number; tracks: Song[] }) {
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const currentSong = usePlayerStore((state) => state.currentSong);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const isActive = currentSong?.id === song.id;
  const unavailable = song.playbackUnavailable === true;
  const playableTracks = tracks.filter((track) => track.playbackUnavailable !== true);
  const playableIndex = playableTracks.findIndex((track) => track.id === song.id);

  return (
    <article
      className={`grid grid-cols-[32px_44px_minmax(0,1fr)_40px] items-center gap-3 rounded-2xl px-3 py-2 transition duration-150 ${isActive ? 'bg-[color-mix(in_srgb,var(--salt-primary)_10%,white)]' : 'hover:bg-[var(--glass-bg-hover)]'}`}
      aria-current={isActive ? 'true' : undefined}
    >
      <span
        className={`text-center text-lg font-extrabold tabular-nums ${isActive && isPlaying ? 'text-[var(--salt-primary)]' : 'text-[var(--salt-mist)]'}`}
        aria-label={`Rank ${rank}`}
      >
        {isActive && isPlaying ? '▶' : rank}
      </span>
      <CoverArt src={song.coverArt} alt={song.album || song.title} loading="lazy" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
      <div className="min-w-0">
        <p className={`truncate text-sm font-semibold leading-tight ${isActive ? 'text-[var(--salt-primary)]' : 'text-[var(--salt-white)]'}`}>{song.title}</p>
        <p className="truncate text-xs text-[var(--salt-mist)]">{song.artist}</p>
      </div>
      {unavailable ? (
        <span
          title="This track's streaming source isn't available right now"
          aria-label="Streaming unavailable"
          className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--salt-mist)]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 5a3 3 0 0 1 6 0v3H9V7z" />
          </svg>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => playAlbum(playableTracks, playableIndex)}
          aria-label={`Play ${song.title}`}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[linear-gradient(145deg,#2494ce,#0d73ae)] text-white shadow-[0_5px_14px_rgba(25,126,184,0.2)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
        </button>
      )}
    </article>
  );
}

export function ChartRail({ songs, label }: { songs: Song[]; label: string }) {
  return (
    <div className="grid gap-0.5 rounded-[24px] border border-[var(--glass-border)] bg-[rgba(255,255,255,0.52)] shadow-[0_12px_32px_rgba(47,117,155,0.06)]">
      {songs.map((song, index) => (
        <ChartRow key={song.id} song={song} rank={index + 1} tracks={songs} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
