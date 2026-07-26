'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  HiArrowTopRightOnSquare,
  HiChevronDoubleRight,
  HiEllipsisHorizontal,
  HiHeart,
  HiOutlineHeart,
  HiPlus,
  HiQueueList,
  HiSquares2X2,
  HiUser,
} from 'react-icons/hi2';
import { usePlayerStore } from '@/store/playerStore';
import { AddToPlaylistDialog } from '@/components/ui/AddToPlaylistDialog';
import type { NavigationItem } from '@/lib/navigation';
import type { Song, ViewType } from '@/types/music';

const MENU_WIDTH = 232;
const VIEWPORT_MARGIN = 8;

interface MenuAction {
  key: string;
  label: string;
  icon: ReactNode;
  href?: string;
  onSelect?: () => void;
  pressed?: boolean;
}

/**
 * The row-level overflow menu. A track row can only afford one control before
 * the title starts truncating, so every secondary action lives here instead of
 * competing for the same 200px: queueing, favouriting, artist and album
 * navigation, and the provenance link the licence terms require.
 *
 * Positioned against the viewport rather than the row because rows sit inside a
 * scrolling pane — an absolutely positioned panel would be clipped by it.
 */
export function TrackMenu({
  song,
  onNavigateWithItem,
  className = '',
}: {
  song: Song;
  onNavigateWithItem?: (view: ViewType, item: NavigationItem | null) => void;
  className?: string;
}) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [playlistDialogOpen, setPlaylistDialogOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<Array<HTMLButtonElement | HTMLAnchorElement | null>>([]);

  const playNext = usePlayerStore((state) => state.playNext);
  const addToQueue = usePlayerStore((state) => state.addToQueue);
  const favorites = usePlayerStore((state) => state.favorites);
  const toggleFavorite = usePlayerStore((state) => state.toggleFavorite);
  const isFavorite = favorites.some((item) => item.id === song.id);
  const unavailable = song.playbackUnavailable === true;

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    setPosition(null);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const actions: MenuAction[] = [
    ...(unavailable ? [] : [
      { key: 'next', label: 'Play next', icon: <HiChevronDoubleRight className="h-4 w-4" aria-hidden />, onSelect: () => playNext(song) },
      { key: 'queue', label: 'Add to queue', icon: <HiPlus className="h-4 w-4" aria-hidden />, onSelect: () => addToQueue(song) },
    ]),
    {
      key: 'favorite',
      label: isFavorite ? 'Remove from Favorites' : 'Add to Favorites',
      icon: isFavorite ? <HiHeart className="h-4 w-4" aria-hidden /> : <HiOutlineHeart className="h-4 w-4" aria-hidden />,
      onSelect: () => toggleFavorite(song),
      pressed: isFavorite,
    },
    {
      key: 'playlist',
      label: 'Add to playlist…',
      icon: <HiQueueList className="h-4 w-4" aria-hidden />,
      onSelect: () => setPlaylistDialogOpen(true),
    },
    ...(onNavigateWithItem ? [
      { key: 'artist', label: 'Go to artist', icon: <HiUser className="h-4 w-4" aria-hidden />, onSelect: () => onNavigateWithItem('artists', { kind: 'artist', id: song.artistId }) },
      ...(song.albumId ? [{ key: 'album', label: 'Go to album', icon: <HiSquares2X2 className="h-4 w-4" aria-hidden />, onSelect: () => onNavigateWithItem('albums', { kind: 'album', id: song.albumId }) }] : []),
    ] : []),
    ...(song.sourceUrl ? [{
      key: 'source',
      // The licence name is the point of this entry, not decoration: it is how
      // a listener checks the terms the track is actually offered under.
      label: `${song.provider} · ${song.licenseName || 'Provider terms'}`,
      icon: <HiArrowTopRightOnSquare className="h-4 w-4" aria-hidden />,
      href: song.sourceUrl,
    }] : []),
  ];

  // Measured after paint so the panel's real height decides whether it opens
  // downward or flips above the trigger.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const height = panel.offsetHeight;
    const below = rect.bottom + 6;
    const top = below + height > window.innerHeight - VIEWPORT_MARGIN
      ? Math.max(VIEWPORT_MARGIN, rect.top - height - 6)
      : below;
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.right - MENU_WIDTH),
      window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN,
    );
    setPosition({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    itemsRef.current[activeIndex]?.focus();
  }, [open, activeIndex, position]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    // A menu anchored to the viewport would drift away from its row on scroll,
    // so scrolling dismisses it rather than chasing the trigger.
    const onScroll = () => close(false);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, close]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Tab') {
      close(false);
      return;
    }
    const last = actions.length - 1;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index >= last ? 0 : index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? last : index - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(last);
    }
  };

  const openWith = (index: number) => {
    setActiveIndex(index);
    setOpen(true);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`More options for ${song.title}`}
        onClick={() => (open ? close() : openWith(0))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); openWith(0); }
          if (event.key === 'ArrowUp') { event.preventDefault(); openWith(actions.length - 1); }
        }}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-white)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] ${open ? 'bg-[var(--glass-bg-hover)] text-[var(--salt-white)]' : ''} ${className}`}
      >
        <HiEllipsisHorizontal className="h-5 w-5" aria-hidden />
      </button>
      {open && (
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-label={`Options for ${song.title}`}
          onKeyDown={onKeyDown}
          style={{
            width: MENU_WIDTH,
            // `visibility` rather than conditional rendering: the panel must be
            // laid out before its height can decide up-versus-down placement.
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            visibility: position ? 'visible' : 'hidden',
          }}
          className="fixed z-[80] overflow-hidden rounded-xl border border-[var(--glass-border)] bg-white py-1 shadow-[0_16px_40px_rgba(16,47,69,0.18)]"
        >
          {actions.map((action, index) => {
            const shared = {
              role: 'menuitem' as const,
              tabIndex: index === activeIndex ? 0 : -1,
              onMouseEnter: () => setActiveIndex(index),
              className: 'flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] text-[var(--salt-white)] transition-colors hover:bg-[var(--glass-bg-hover)] focus:bg-[var(--glass-bg-hover)] focus:outline-none',
            };
            if (action.href) {
              return (
                <a
                  key={action.key}
                  {...shared}
                  ref={(node) => { itemsRef.current[index] = node; }}
                  href={action.href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => close(false)}
                >
                  <span className="shrink-0 text-[var(--salt-mist)]">{action.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{action.label}</span>
                </a>
              );
            }
            return (
              <button
                key={action.key}
                {...shared}
                ref={(node) => { itemsRef.current[index] = node; }}
                type="button"
                aria-pressed={action.pressed}
                onClick={() => { action.onSelect?.(); close(); }}
              >
                <span className={`shrink-0 ${action.pressed ? 'text-[#d84f5f]' : 'text-[var(--salt-mist)]'}`}>{action.icon}</span>
                <span className="min-w-0 flex-1 truncate">{action.label}</span>
              </button>
            );
          })}
        </div>
      )}
      {playlistDialogOpen && (
        <AddToPlaylistDialog
          song={song}
          onClose={() => {
            setPlaylistDialogOpen(false);
            triggerRef.current?.focus();
          }}
        />
      )}
    </>
  );
}
