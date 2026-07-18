'use client';

import { Attribution } from '@/components/ui/Attribution';
import { CoverArt } from '@/components/ui/CoverArt';
import { usePlayerStore } from '@/store/playerStore';

type LibraryKind = 'favorites' | 'history';

export function PersonalLibraryView({ kind }: { kind: LibraryKind }) {
  const songs = usePlayerStore((state) => state[kind]);
  const playSong = usePlayerStore((state) => state.playSong);
  const addToQueue = usePlayerStore((state) => state.addToQueue);
  const toggleFavorite = usePlayerStore((state) => state.toggleFavorite);
  const clearHistory = usePlayerStore((state) => state.clearHistory);
  const favorites = usePlayerStore((state) => state.favorites);
  const title = kind === 'favorites' ? 'Favorites' : 'Recently Played';

  return (
    <section className="space-y-5 pb-[120px] pt-5">
      <div className="flex items-end justify-between gap-4">
        <div><h2 className="text-3xl font-semibold text-[var(--salt-white)]" style={{ fontFamily: 'var(--font-display)' }}>{title}</h2><p className="mt-1 text-sm text-[var(--salt-mist)]">{songs.length ? `${songs.length} saved ${songs.length === 1 ? 'track' : 'tracks'}` : 'Your library will appear here.'}</p></div>
        {kind === 'history' && songs.length > 0 && <button type="button" onClick={clearHistory} className="rounded-full border border-[var(--glass-border)] bg-white/60 px-3 py-2 text-xs text-[var(--salt-mist)] shadow-sm transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-primary)]">Clear history</button>}
      </div>
      {!songs.length ? <div className="rounded-[28px] border border-dashed border-[var(--glass-border-active)] bg-[rgba(255,255,255,0.58)] px-6 py-14 text-center text-sm text-[var(--salt-mist)] shadow-[inset_0_1px_0_white] backdrop-blur-xl">{kind === 'favorites' ? 'Favorite a track to keep it close.' : 'Play a verified track and it will be remembered here.'}</div> : <div className="space-y-1">{songs.map((song) => {
        const favorite = favorites.some((item) => item.id === song.id);
        return <article key={song.id} className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-transparent px-3 py-2 transition-[background,border-color,box-shadow] hover:border-[var(--glass-border)] hover:bg-[var(--glass-bg-hover)] hover:shadow-[0_5px_18px_rgba(42,132,179,0.08)]"><CoverArt src={song.coverArt} alt="" className="h-11 w-11 rounded-xl border border-white object-cover shadow-sm" /><div className="min-w-0"><p className="truncate text-sm font-medium text-[var(--salt-white)]">{song.title}</p><p className="truncate text-xs text-[var(--salt-mist)]">{song.artist}</p><div className="mt-1"><Attribution song={song} compact /></div></div><div className="flex gap-1"><button type="button" onClick={() => toggleFavorite(song)} aria-label={`${favorite ? 'Remove' : 'Add'} ${song.title} ${favorite ? 'from' : 'to'} favorites`} aria-pressed={favorite} className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--salt-primary)] hover:bg-[var(--salt-ghost)] focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]">{favorite ? '♥' : '♡'}</button><button type="button" onClick={() => addToQueue(song)} aria-label={`Add ${song.title} to queue`} className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--glass-border)] bg-white/60 text-[var(--salt-primary)] shadow-sm focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]">＋</button><button type="button" onClick={() => playSong(song)} aria-label={`Play ${song.title}`} className="flex h-9 w-9 items-center justify-center rounded-full bg-[linear-gradient(145deg,#2494ce,#0d73ae)] text-white shadow-[0_5px_14px_rgba(25,126,184,0.2)] focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]">▶</button></div></article>;
      })}</div>}
    </section>
  );
}
