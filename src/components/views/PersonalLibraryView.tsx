'use client';

import { SongCard } from './SongCard';
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
          information left to give is how much is in it. */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-[13px] text-[var(--salt-mist)]">{songs.length ? `${songs.length} saved ${songs.length === 1 ? 'track' : 'tracks'}` : 'Your library will appear here.'}</p>
        {kind === 'history' && songs.length > 0 && <button type="button" onClick={clearHistory} className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-primary)]">Clear history</button>}
      </div>
      {!songs.length ? (
        <div className="rounded-xl border border-[var(--glass-border)] bg-white px-6 py-12 text-center text-[13px] text-[var(--salt-mist)]">
          <p>{kind === 'favorites' ? 'Favorite a track to keep it close.' : 'Play a verified track and it will be remembered here.'}</p>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('trending')}
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-full bg-[var(--salt-primary)] px-4 text-[13px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
            >
              Browse trending
            </button>
          )}
        </div>
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
