'use client';

import { useState } from 'react';
import { HiArrowLeft, HiArrowsRightLeft, HiPlay, HiPlus, HiTrash } from 'react-icons/hi2';
import { usePlayerStore } from '@/store/playerStore';
import { CoverArt } from '@/components/ui/CoverArt';
import { StatusButton, StatusPanel } from '@/components/ui/StatusPanel';
import { SongCard } from './SongCard';
import { playableSongs } from './newViewModel';
import type { NavigationItem } from '@/lib/navigation';
import type { Playlist, ViewType } from '@/types/music';

interface PlaylistsViewProps {
  onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void;
  onNavigate?: (view: ViewType) => void;
}

/**
 * Playlists are selected with local state rather than a URL item, unlike albums
 * and artists. They live only in this browser's storage, so a shareable link to
 * one would resolve to nothing anywhere else.
 */
export function PlaylistsView({ onNavigateWithItem, onNavigate }: PlaylistsViewProps) {
  const playlists = usePlayerStore((state) => state.playlists);
  const createPlaylist = usePlayerStore((state) => state.createPlaylist);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const openPlaylist = playlists.find((playlist) => playlist.id === openId) ?? null;

  if (openPlaylist) {
    return (
      <PlaylistDetail
        playlist={openPlaylist}
        onBack={() => setOpenId(null)}
        onNavigateWithItem={onNavigateWithItem}
      />
    );
  }

  const submit = () => {
    const id = createPlaylist(newName);
    if (!id) return;
    setNewName('');
    setOpenId(id);
  };

  return (
    <section className="space-y-4 pb-6">
      <div className="flex max-w-md items-center gap-2">
        <label htmlFor="new-playlist" className="sr-only">New playlist name</label>
        <input
          id="new-playlist"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            submit();
          }}
          placeholder="New playlist name"
          maxLength={80}
          className="h-10 min-w-0 flex-1 rounded-lg border border-[var(--glass-border)] bg-white px-3 text-[13px] text-[var(--salt-white)] outline-none transition-[border-color] focus:border-[var(--salt-primary)]"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!newName.trim()}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-[var(--salt-primary)] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--salt-bright)] disabled:cursor-not-allowed disabled:bg-[#a7b3ba]"
        >
          <HiPlus className="h-4 w-4" aria-hidden />
          Create
        </button>
      </div>

      {playlists.length === 0 ? (
        <StatusPanel
          align="center"
          title="No playlists yet"
          body="Name one above, or use the ··· menu on any track to start a playlist from it."
          actions={onNavigate ? <StatusButton onClick={() => onNavigate('trending')}>Browse trending</StatusButton> : undefined}
        />
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
          {playlists.map((playlist) => (
            <PlaylistCard key={playlist.id} playlist={playlist} onOpen={() => setOpenId(playlist.id)} />
          ))}
        </div>
      )}
    </section>
  );
}

/** A 2×2 mosaic of the first four covers, the way a playlist tile is read. */
function PlaylistMosaic({ playlist }: { playlist: Playlist }) {
  const covers = playlist.songs.slice(0, 4);
  if (covers.length === 0) {
    return <span className="block h-full w-full bg-[var(--salt-ghost)]" />;
  }
  if (covers.length < 4) {
    return <CoverArt src={covers[0].coverArt} alt="" loading="lazy" sizes="150px" className="h-full w-full object-cover" />;
  }
  return (
    <span className="grid h-full w-full grid-cols-2 grid-rows-2">
      {covers.map((song) => (
        <CoverArt key={song.id} src={song.coverArt} alt="" loading="lazy" sizes="75px" className="h-full w-full object-cover" />
      ))}
    </span>
  );
}

function PlaylistCard({ playlist, onOpen }: { playlist: Playlist; onOpen: () => void }) {
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const ready = playableSongs(playlist.songs);

  return (
    <article className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open playlist ${playlist.name}`}
        className="group block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
      >
        <span className="relative block aspect-square overflow-hidden rounded-md bg-[var(--salt-ghost)]">
          <PlaylistMosaic playlist={playlist} />
          {ready.length > 0 && (
            <span
              role="button"
              tabIndex={-1}
              aria-hidden
              onClick={(event) => { event.stopPropagation(); playAlbum(ready, 0); }}
              className="absolute inset-0 flex items-center justify-center bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            >
              <HiPlay className="h-7 w-7" />
            </span>
          )}
        </span>
        <span className="mt-2 block truncate text-[13px] font-medium text-[var(--salt-white)]">{playlist.name}</span>
        <span className="mt-0.5 block truncate text-xs text-[var(--salt-mist)]">
          {playlist.songs.length} {playlist.songs.length === 1 ? 'track' : 'tracks'}
        </span>
      </button>
    </article>
  );
}

function PlaylistDetail({
  playlist,
  onBack,
  onNavigateWithItem,
}: {
  playlist: Playlist;
  onBack: () => void;
  onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void;
}) {
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const renamePlaylist = usePlayerStore((state) => state.renamePlaylist);
  const deletePlaylist = usePlayerStore((state) => state.deletePlaylist);
  const removeFromPlaylist = usePlayerStore((state) => state.removeFromPlaylist);
  const reorderPlaylist = usePlayerStore((state) => state.reorderPlaylist);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(playlist.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const ready = playableSongs(playlist.songs);
  const totalSeconds = playlist.songs.reduce((sum, song) => sum + (Number.isFinite(song.duration) ? song.duration : 0), 0);
  const minutes = Math.round(totalSeconds / 60);

  const commitRename = () => {
    renamePlaylist(playlist.id, draftName);
    setRenaming(false);
  };

  return (
    <section className="space-y-4 pb-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-[13px] font-semibold text-[var(--salt-primary)] transition-colors hover:bg-[var(--glass-bg-hover)]"
      >
        <HiArrowLeft className="h-4 w-4" aria-hidden />
        All playlists
      </button>

      <div className="flex items-start gap-4">
        <span className="block h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-[var(--salt-ghost)] sm:h-[132px] sm:w-[132px]">
          <PlaylistMosaic playlist={playlist} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--salt-mist)]">Playlist</p>
          {renaming ? (
            <div className="mt-1 flex max-w-sm items-center gap-2">
              <label htmlFor="rename-playlist" className="sr-only">Playlist name</label>
              <input
                id="rename-playlist"
                autoFocus
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); commitRename(); }
                  if (event.key === 'Escape') { event.preventDefault(); setDraftName(playlist.name); setRenaming(false); }
                }}
                maxLength={80}
                className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--glass-border)] bg-white px-3 text-[15px] font-semibold text-[var(--salt-white)] outline-none focus:border-[var(--salt-primary)]"
              />
              <button type="button" onClick={commitRename} className="h-9 shrink-0 rounded-full bg-[var(--salt-primary)] px-3 text-[13px] font-semibold text-white">Save</button>
            </div>
          ) : (
            <h2 className="mt-1 truncate text-xl font-bold text-[var(--salt-white)] sm:text-2xl">{playlist.name}</h2>
          )}
          <p className="mt-1 text-[13px] text-[var(--salt-mist)]">
            {playlist.songs.length} {playlist.songs.length === 1 ? 'track' : 'tracks'}
            {minutes > 0 && ` · about ${minutes} min`}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => playAlbum(ready, 0)}
              disabled={ready.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#d84f5f] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#bd3f4f] disabled:cursor-not-allowed disabled:bg-[#a7b3ba]"
            >
              <HiPlay className="h-4 w-4" aria-hidden />
              Play
            </button>
            <button
              type="button"
              onClick={() => playAlbum([...ready].sort(() => Math.random() - 0.5), 0)}
              disabled={ready.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--glass-border)] px-4 text-[13px] font-semibold text-[var(--salt-primary)] transition-colors hover:bg-[var(--glass-bg-hover)] disabled:cursor-not-allowed disabled:text-[var(--salt-mist)]"
            >
              <HiArrowsRightLeft className="h-4 w-4" aria-hidden />
              Shuffle
            </button>
            {!renaming && (
              <button
                type="button"
                onClick={() => { setDraftName(playlist.name); setRenaming(true); }}
                className="inline-flex h-9 items-center rounded-full px-3 text-[13px] font-semibold text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-white)]"
              >
                Rename
              </button>
            )}
            {confirmingDelete ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-[#fdf5f5] px-3 py-1.5 text-[13px] text-[#77343d]">
                Delete this playlist?
                <button type="button" onClick={() => { deletePlaylist(playlist.id); onBack(); }} className="font-semibold underline">Delete</button>
                <button type="button" onClick={() => setConfirmingDelete(false)} className="underline">Cancel</button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--danger)]"
              >
                <HiTrash className="h-4 w-4" aria-hidden />
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {playlist.songs.length === 0 ? (
        <StatusPanel
          align="center"
          title="This playlist is empty"
          body="Use the ··· menu on any track and choose “Add to playlist”."
        />
      ) : (
        <div className="grid">
          {playlist.songs.map((song, index) => (
            <SongCard
              key={song.id}
              song={song}
              index={index}
              tracks={playlist.songs}
              onNavigateWithItem={onNavigateWithItem}
              trailing={(
                <span className="flex shrink-0 items-center">
                  <button type="button" onClick={() => reorderPlaylist(playlist.id, index, index - 1)} disabled={index === 0} aria-label={`Move ${song.title} earlier`} className="h-7 w-6 rounded text-xs text-[var(--salt-mist)] hover:bg-[var(--salt-ghost)] disabled:opacity-30">↑</button>
                  <button type="button" onClick={() => reorderPlaylist(playlist.id, index, index + 1)} disabled={index === playlist.songs.length - 1} aria-label={`Move ${song.title} later`} className="h-7 w-6 rounded text-xs text-[var(--salt-mist)] hover:bg-[var(--salt-ghost)] disabled:opacity-30">↓</button>
                  <button type="button" onClick={() => removeFromPlaylist(playlist.id, song.id)} aria-label={`Remove ${song.title} from ${playlist.name}`} className="h-7 w-6 rounded text-sm text-[var(--salt-mist)] hover:bg-[var(--salt-ghost)]">×</button>
                </span>
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}
