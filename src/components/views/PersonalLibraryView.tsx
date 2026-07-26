'use client';

import { SongCard } from './SongCard';
import { StatusButton, StatusPanel } from '@/components/ui/StatusPanel';
import { usePlayerStore } from '@/store/playerStore';
import type { NavigationItem } from '@/lib/navigation';
import type { ViewType } from '@/types/music';

type LibraryKind = 'favorites' | 'history';

export function PersonalLibraryView({ kind, onNavigateWithItem, onNavigate }: {
  kind: LibraryKind;
  onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void;
  onNavigate?: (view: ViewType) => void;
}) {
  const songs = usePlayerStore((state) => state[kind]);
  const clearHistory = usePlayerStore((state) => state.clearHistory);

  return (
    <section className="space-y-3 pb-6">
      {/* The page header already names this view, so the only heading-level
          information left to give is how much is in it — and when it is empty
          the panel below says so, which makes a count line redundant. */}
      {songs.length > 0 && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-[13px] text-[var(--salt-mist)]">{songs.length} saved {songs.length === 1 ? 'track' : 'tracks'}</p>
          {kind === 'history' && <button type="button" onClick={clearHistory} className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-primary)]">Clear history</button>}
        </div>
      )}
      {!songs.length ? (
        <StatusPanel
          align="center"
          title={kind === 'favorites' ? 'Nothing saved yet' : 'Nothing played yet'}
          body={kind === 'favorites'
            ? 'Favorite a track from any list and it will be kept here.'
            : 'Play a verified track and it will be remembered here.'}
          actions={onNavigate ? <StatusButton onClick={() => onNavigate('trending')}>Browse trending</StatusButton> : undefined}
        />
      ) : (
        <div className="grid">
          {songs.map((song, index) => (
            <SongCard key={song.id} song={song} index={index} tracks={songs} showIndex={kind === 'favorites'} onNavigateWithItem={onNavigateWithItem} />
          ))}
        </div>
      )}
    </section>
  );
}
