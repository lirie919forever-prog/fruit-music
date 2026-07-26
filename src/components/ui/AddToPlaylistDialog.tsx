'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { HiCheck, HiPlus, HiXMark } from 'react-icons/hi2';
import { usePlayerStore } from '@/store/playerStore';
import type { Song } from '@/types/music';

/**
 * Chosen over a nested submenu inside TrackMenu: the list of playlists is
 * unbounded and creating one needs a text field, neither of which a menu can
 * hold without inventing its own keyboard model. A dialog gets the standard one
 * for free — Escape closes, focus is trapped, focus returns to the opener.
 */
export function AddToPlaylistDialog({ song, onClose }: { song: Song; onClose: () => void }) {
  const titleId = useId();
  const inputId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');

  const playlists = usePlayerStore((state) => state.playlists);
  const createPlaylist = usePlayerStore((state) => state.createPlaylist);
  const addToPlaylist = usePlayerStore((state) => state.addToPlaylist);
  const removeFromPlaylist = usePlayerStore((state) => state.removeFromPlaylist);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    firstFieldRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!dialogRef.current?.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [close]);

  const submitNewPlaylist = () => {
    // Creating with the song already in it saves the extra click the two-step
    // "create, then add" flow would cost.
    if (createPlaylist(name, [song])) close();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button tabIndex={-1} aria-label="Close" onClick={close} className="absolute inset-0 bg-[rgba(13,43,62,0.34)]" />
      <div ref={dialogRef} className="relative flex max-h-[min(560px,86dvh)] w-full max-w-sm flex-col overflow-hidden rounded-xl border border-[var(--glass-border)] bg-white shadow-[0_24px_60px_rgba(16,47,69,0.24)]">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--glass-border)] px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[15px] font-bold text-[var(--salt-white)]">Add to playlist</h2>
            <p className="mt-0.5 truncate text-xs text-[var(--salt-mist)]">{song.title}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-white)]"
          >
            <HiXMark className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] px-4 py-3">
          <label htmlFor={inputId} className="sr-only">New playlist name</label>
          <input
            id={inputId}
            ref={firstFieldRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              submitNewPlaylist();
            }}
            placeholder="New playlist name"
            maxLength={80}
            className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--glass-border)] bg-white px-3 text-[13px] text-[var(--salt-white)] outline-none transition-[border-color] focus:border-[var(--salt-primary)]"
          />
          <button
            type="button"
            onClick={submitNewPlaylist}
            disabled={!name.trim()}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--salt-primary)] px-3 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--salt-bright)] disabled:cursor-not-allowed disabled:bg-[#a7b3ba]"
          >
            <HiPlus className="h-4 w-4" aria-hidden />
            Create
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {playlists.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-[var(--salt-mist)]">No playlists yet. Name one above to start.</p>
          ) : playlists.map((playlist) => {
            const included = playlist.songs.some((item) => item.id === song.id);
            return (
              <button
                key={playlist.id}
                type="button"
                aria-pressed={included}
                onClick={() => (included ? removeFromPlaylist(playlist.id, song.id) : addToPlaylist(playlist.id, song))}
                className="flex h-12 w-full items-center gap-3 border-b border-[var(--glass-border)] px-4 text-left transition-colors last:border-b-0 hover:bg-[var(--glass-bg-hover)]"
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${included ? 'border-[var(--salt-primary)] bg-[var(--salt-primary)] text-white' : 'border-[var(--glass-border-active)]'}`}>
                  {included && <HiCheck className="h-3.5 w-3.5" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-[var(--salt-white)]">{playlist.name}</span>
                  <span className="block text-xs text-[var(--salt-mist)]">{playlist.songs.length} {playlist.songs.length === 1 ? 'track' : 'tracks'}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
