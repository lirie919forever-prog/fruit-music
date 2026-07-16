'use client';

import { useQuery } from '@tanstack/react-query';
import { usePlayerStore } from '@/store/playerStore';
import { Attribution } from '@/components/ui/Attribution';
import { providerErrorMessage } from '@/lib/providers/errors';
import type { Song, ViewType } from '@/types/music';

export interface CategoryConfig {
  view: ViewType;
  title: string;
  description: string;
  fetchFn: () => Promise<Song[]>;
  queryKey: string[];
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function CategoryGrid({ config }: { config: CategoryConfig }) {
  const { data: songs, isLoading, isError, error, refetch } = useQuery({
    queryKey: config.queryKey,
    queryFn: config.fetchFn,
    staleTime: 60_000,
  });

  if (isLoading) return <TrackSkeleton />;
  if (isError) {
    return (
      <div className="flex flex-col items-start gap-3 px-4 py-10 text-[var(--salt-mist)] sm:px-6">
        <p>{providerErrorMessage(error)}</p>
        <button type="button" onClick={() => void refetch()} className="rounded-full border border-[var(--glass-border-active)] px-4 py-2 text-sm text-[var(--salt-white)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]">Try again</button>
      </div>
    );
  }
  if (!songs?.length) {
    return <p className="px-4 py-10 text-[var(--salt-mist)] sm:px-6">No verified tracks are available for this category.</p>;
  }

  return (
    <section className="pb-[120px]">
      <div className="px-4 pb-3 pt-5 sm:px-6">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-[28px] font-semibold italic text-[var(--salt-white)]" style={{ fontFamily: 'var(--font-display)' }}>{config.title}</h2>
          <span className="rounded-full border border-[var(--glass-border)] bg-[var(--salt-ghost)] px-2.5 py-0.5 text-[11px] text-[var(--salt-mist)]">{songs.length} tracks</span>
        </div>
        <p className="mt-1 text-xs text-[var(--salt-mist)]">{config.description}</p>
      </div>
      <div className="space-y-1">
        {songs.map((song, index) => <TrackRow key={`${song.id}-${index}`} song={song} songs={songs} index={index} />)}
      </div>
    </section>
  );
}

function TrackRow({ song, songs, index }: { song: Song; songs: Song[]; index: number }) {
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const addToQueue = usePlayerStore((state) => state.addToQueue);
  const currentSong = usePlayerStore((state) => state.currentSong);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const isActive = currentSong?.id === song.id;

  return (
    <article
      className={`grid grid-cols-[32px_40px_minmax(0,1fr)_auto] items-center gap-2 border-l-2 px-3 py-2 sm:grid-cols-[36px_48px_minmax(0,1fr)_56px_76px] sm:px-6 ${isActive ? 'border-[var(--salt-primary)] bg-[color-mix(in_srgb,var(--salt-primary)_8%,transparent)]' : 'border-transparent'}`}
    >
      <span className="hidden text-center text-xs tabular-nums text-[var(--salt-mist)] sm:block" aria-label={`Track ${index + 1}`}>
        {isActive && isPlaying ? '▶' : index + 1}
      </span>
      <img src={song.coverArt} alt={song.album} loading="lazy" decoding="async" className="h-10 w-10 rounded-md object-cover" />
      <div className="min-w-0">
        <p className={`truncate text-sm font-medium ${isActive ? 'text-[var(--salt-primary)]' : 'text-[var(--salt-white)]'}`}>{song.title}</p>
        <p className="truncate text-xs text-[var(--salt-mist)]">{song.artist}{song.album ? ` · ${song.album}` : ''}</p>
        <div className="mt-1"><Attribution song={song} compact /></div>
      </div>
      <span className="hidden text-right text-xs tabular-nums text-[var(--salt-mist)] sm:block">{formatDuration(song.duration)}</span>
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={() => addToQueue(song)}
          aria-label={`Add ${song.title} to queue`}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--glass-border)] text-[var(--salt-bright)] hover:bg-[var(--salt-ghost)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z" /></svg>
        </button>
        <button
          type="button"
          onClick={() => playAlbum(songs, index)}
          aria-label={`Play ${song.title} by ${song.artist}`}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--salt-primary)] text-[var(--sea-abyss)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-white)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
        </button>
      </div>
    </article>
  );
}

function TrackSkeleton() {
  return (
    <div className="space-y-1 pb-[120px] pt-5">
      <div className="mx-4 h-8 w-32 animate-pulse rounded bg-[var(--salt-ghost)] sm:mx-6" />
      {Array.from({ length: 12 }).map((_, index) => (
        <div key={index} className="grid grid-cols-[40px_minmax(0,1fr)_72px] items-center gap-2 px-3 py-2 sm:grid-cols-[36px_48px_minmax(0,1fr)_56px_76px] sm:px-6">
          <div className="hidden h-4 w-5 animate-pulse rounded bg-[var(--salt-ghost)] sm:block" />
          <div className="h-10 w-10 animate-pulse rounded-md bg-[var(--salt-ghost)]" />
          <div className="space-y-2"><div className="h-3 w-3/5 animate-pulse rounded bg-[var(--salt-ghost)]" /><div className="h-2.5 w-2/5 animate-pulse rounded bg-[var(--salt-ghost)]" /></div>
          <div className="h-8 w-[72px] animate-pulse rounded bg-[var(--salt-ghost)]" />
        </div>
      ))}
    </div>
  );
}
