'use client';

import { ArrowUpDown, Play } from 'lucide-react';
import { SongCard } from './SongCard';
import { StatusButton, StatusPanel } from '@/components/ui/StatusPanel';
import { usePlayerStore } from '@/store/playerStore';
import { playableSongs } from './newViewModel';
import { VirtualList } from '@/components/ui/VirtualList';
import type { NavigationItem } from '@/lib/navigation';
import type { ViewType } from '@/types/music';

type LibraryKind = 'favorites' | 'history';

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function formatLibraryDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 min';
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function PersonalLibraryView({
  kind,
  onNavigateWithItem,
  onNavigate,
}: {
  kind: LibraryKind;
  onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void;
  onNavigate?: (view: ViewType) => void;
}) {
  const songs = usePlayerStore((state) => state[kind]);
  const clearHistory = usePlayerStore((state) => state.clearHistory);
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const readySongs = playableSongs(songs);
  const totalDuration = songs.reduce((sum, song) => sum + (Number.isFinite(song.duration) ? song.duration : 0), 0);

  return (
    <section className="space-y-3 pb-6">
      {/* The page header already names this view, so the only heading-level
          information left to give is how much is in it — and when it is empty
          the panel below says so, which makes a count line redundant. */}
      {songs.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[13px] text-[var(--salt-mist)]">
              <span>
                {songs.length} {kind === 'favorites' ? 'saved' : 'recent'} {songs.length === 1 ? 'track' : 'tracks'}
              </span>
              <span className="text-[var(--pearl-whisper)]" aria-hidden>
                /
              </span>
              <span>{formatLibraryDuration(totalDuration)}</span>
            </p>
            {readySongs.length < songs.length && (
              <p className="mt-1 text-[11px] text-[var(--salt-mist)]">
                {songs.length - readySongs.length} unavailable source skipped
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => playAlbum(readySongs, 0)}
              disabled={readySongs.length === 0}
              className="marea-primary-action inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold text-white disabled:cursor-not-allowed"
            >
              <Play className="h-3.5 w-3.5" aria-hidden />
              Play all
            </button>
            <button
              type="button"
              onClick={() => playAlbum(shuffled(readySongs), 0)}
              disabled={readySongs.length < 2}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--glass-border)] bg-white px-3.5 text-xs font-semibold text-[var(--salt-primary)] transition-colors hover:bg-[var(--glass-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowUpDown className="h-3.5 w-3.5" aria-hidden />
              Shuffle
            </button>
            {kind === 'history' && (
              <button
                type="button"
                onClick={clearHistory}
                className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-primary)]"
              >
                Clear history
              </button>
            )}
          </div>
        </div>
      )}
      {!songs.length ? (
        <StatusPanel
          align="center"
          title={kind === 'favorites' ? 'Nothing saved yet' : 'Nothing played yet'}
          body={
            kind === 'favorites'
              ? 'Favorite a track from any list and it will be kept here.'
              : 'Play a verified track and it will be remembered here.'
          }
          actions={
            onNavigate ? <StatusButton onClick={() => onNavigate('trending')}>Browse trending</StatusButton> : undefined
          }
        />
      ) : (
        <VirtualList
          items={songs}
          estimateSize={56}
          label={kind === 'favorites' ? 'Favorite tracks' : 'Recently played tracks'}
          getItemKey={(song) => song.id}
          className="border-y border-[var(--glass-border)]"
          renderItem={(song, index) => (
            <SongCard
              song={song}
              index={index}
              tracks={songs}
              showIndex={kind === 'favorites'}
              onNavigateWithItem={onNavigateWithItem}
            />
          )}
        />
      )}
    </section>
  );
}
