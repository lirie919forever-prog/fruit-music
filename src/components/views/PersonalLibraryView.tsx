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
  const title = kind === 'favorites' ? 'Favorites' : 'Recently Played';

  return (
    <section className="space-y-5 pb-[120px] pt-5">
      <div className="flex items-end justify-between gap-4">
        <div><h2 className="text-3xl font-semibold text-[var(--salt-white)]" style={{ fontFamily: 'var(--font-display)' }}>{title}</h2><p className="mt-1 text-sm text-[var(--salt-mist)]">{songs.length ? `${songs.length} saved ${songs.length === 1 ? 'track' : 'tracks'}` : 'Your library will appear here.'}</p></div>
        {kind === 'history' && songs.length > 0 && <button type="button" onClick={clearHistory} className="rounded-full border border-[var(--glass-border)] bg-white/60 px-3 py-2 text-xs text-[var(--salt-mist)] shadow-sm transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-primary)]">Clear history</button>}
      </div>
      {!songs.length ? (
        <div className="rounded-[28px] border border-dashed border-[var(--glass-border-active)] bg-[rgba(255,255,255,0.58)] px-6 py-14 text-center text-sm text-[var(--salt-mist)] shadow-[inset_0_1px_0_white] backdrop-blur-xl">
          <p>{kind === 'favorites' ? 'Favorite a track to keep it close.' : 'Play a verified track and it will be remembered here.'}</p>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('trending')}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-[var(--salt-primary)] px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
            >
              Browse trending
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          {songs.map((song, index) => (
            <SongCard key={song.id} song={song} index={index} tracks={songs} onNavigateWithItem={onNavigateWithItem} />
          ))}
        </div>
      )}
    </section>
  );
}
