'use client';

import {
  ExternalLink,
  ChevronsRight,
  MoreHorizontal,
  Heart,
  Plus,
  ListMusic,
  LayoutGrid,
  Sparkles,
  User,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePlayerStore } from '@/store/playerStore';
import { AddToPlaylistDialog } from '@/components/ui/AddToPlaylistDialog';
import type { NavigationItem } from '@/lib/navigation';
import { buildStationQueue } from '@/components/views/newViewModel';
import type { Song, ViewType } from '@/types/music';
import { useMusicCatalog } from '@/lib/musicCatalog';

const MENU_WIDTH = 232;
const VIEWPORT_MARGIN = 8;
const OPEN_SCROLL_GRACE_MS = 250;

function findScrollContainer(element: HTMLElement | null): HTMLElement | null {
  let current = element?.parentElement ?? null;
  while (current && current !== document.body) {
    const styles = window.getComputedStyle(current);
    if (/(?:auto|scroll|overlay)/.test(`${styles.overflow} ${styles.overflowX} ${styles.overflowY}`)) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

interface MenuAction {
  key: string;
  label: string;
  icon: ReactNode;
  href?: string;
  onSelect?: () => void;
  closeOnSelect?: boolean;
  disabled?: boolean;
  /**
   * Marks an item that toggles rather than fires. Rendered as
   * `role="menuitemcheckbox"` with `aria-checked`, which is the only way a menu
   * may express state — `aria-pressed` is not allowed on `role="menuitem"` and
   * is dropped, so favourite state was announced as nothing at all.
   */
  checked?: boolean;
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
  const [stationStatus, setStationStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<Array<HTMLButtonElement | HTMLAnchorElement | null>>([]);
  const scrollGraceUntilRef = useRef(0);

  const playNext = usePlayerStore((state) => state.playNext);
  const addToQueue = usePlayerStore((state) => state.addToQueue);
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const catalog = useMusicCatalog();
  const favorites = usePlayerStore((state) => state.favorites);
  const toggleFavorite = usePlayerStore((state) => state.toggleFavorite);
  const isFavorite = favorites.some((item) => item.id === song.id);
  const unavailable = song.playbackUnavailable === true;
  const canStartStation = !unavailable && !song.isLive && song.genre.trim().length > 0;

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    setPosition(null);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const startStation = useCallback(async () => {
    if (stationStatus === 'loading') return;
    setStationStatus('loading');
    try {
      const stationCatalog = await catalog.getGenreSongs(song.genre, 30);
      const queue = buildStationQueue(song, stationCatalog.results, 12);
      if (queue.length === 0) throw new Error('No playable station tracks were returned.');
      playAlbum(queue, 0);
      setStationStatus('idle');
      close();
    } catch {
      setStationStatus('error');
    }
  }, [catalog, close, playAlbum, song, stationStatus]);

  const actions: MenuAction[] = [
    ...(canStartStation
      ? [
          {
            key: 'station',
            label:
              stationStatus === 'loading'
                ? 'Starting station...'
                : stationStatus === 'error'
                  ? 'Try station again'
                  : 'Start station',
            icon: <Sparkles className="h-4 w-4" aria-hidden />,
            onSelect: () => void startStation(),
            closeOnSelect: false,
            disabled: stationStatus === 'loading',
          },
        ]
      : []),
    ...(unavailable
      ? []
      : [
          {
            key: 'next',
            label: 'Play next',
            icon: <ChevronsRight className="h-4 w-4" aria-hidden />,
            onSelect: () => playNext(song),
          },
          {
            key: 'queue',
            label: 'Add to queue',
            icon: <Plus className="h-4 w-4" aria-hidden />,
            onSelect: () => addToQueue(song),
          },
        ]),
    {
      key: 'favorite',
      label: isFavorite ? 'Remove from Favorites' : 'Add to Favorites',
      icon: isFavorite ? (
        <Heart className="h-4 w-4 fill-current" aria-hidden />
      ) : (
        <Heart className="h-4 w-4" aria-hidden />
      ),
      onSelect: () => toggleFavorite(song),
      checked: isFavorite,
    },
    {
      key: 'playlist',
      label: 'Add to playlist',
      icon: <ListMusic className="h-4 w-4" aria-hidden />,
      onSelect: () => setPlaylistDialogOpen(true),
    },
    ...(onNavigateWithItem
      ? [
          {
            key: 'artist',
            label: 'Go to artist',
            icon: <User className="h-4 w-4" aria-hidden />,
            onSelect: () => onNavigateWithItem('artists', { kind: 'artist', id: song.artistId }),
          },
          ...(song.albumId
            ? [
                {
                  key: 'album',
                  label: 'Go to album',
                  icon: <LayoutGrid className="h-4 w-4" aria-hidden />,
                  onSelect: () => onNavigateWithItem('albums', { kind: 'album', id: song.albumId }),
                },
              ]
            : []),
        ]
      : []),
    ...(song.sourceUrl
      ? [
          {
            key: 'source',
            // The licence name is the point of this entry, not decoration: it is how
            // a listener checks the terms the track is actually offered under.
            label: `${song.provider} - ${song.licenseName || 'Provider terms'}`,
            icon: <ExternalLink className="h-4 w-4" aria-hidden />,
            href: song.sourceUrl,
          },
        ]
      : []),
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
    const top =
      below + height > window.innerHeight - VIEWPORT_MARGIN ? Math.max(VIEWPORT_MARGIN, rect.top - height - 6) : below;
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.right - MENU_WIDTH),
      window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN,
    );
    setPosition({ top, left });
  }, [open]);

  useEffect(() => {
    // The first render is intentionally hidden at top:0 while the fixed panel
    // measures itself. Focusing before placement makes the browser scroll to
    // that temporary location, which the dismissal listener correctly sees as
    // a user scroll and closes the menu during the same click.
    if (!open || !position) return;
    itemsRef.current[activeIndex]?.focus({ preventScroll: true });
  }, [open, activeIndex, position]);

  useEffect(() => {
    if (!open) return;
    const scrollContainer = findScrollContainer(triggerRef.current);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    // A menu anchored to the viewport would drift away from its row on scroll,
    // so scrolling dismisses it rather than chasing the trigger.
    const onScroll = (event: Event) => {
      const target = event.target;
      const isDocumentScroll =
        target === window || target === document || target === document.documentElement || target === document.body;
      if (!isDocumentScroll && target !== scrollContainer) return;
      if (Date.now() < scrollGraceUntilRef.current) return;
      // VirtualList emits an untrusted scroll event when it resynchronizes a
      // newly visible scrollport. That is layout bookkeeping, not listener
      // intent, and closing here makes a cold-load click look unreliable.
      if (!event.isTrusted) return;
      close(false);
    };
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
    // Focusing the first item and the surrounding virtualizer can produce a
    // browser scroll while the fixed panel settles. It is not listener intent.
    scrollGraceUntilRef.current = Date.now() + OPEN_SCROLL_GRACE_MS;
    setActiveIndex(index);
    setOpen(true);
  };

  return (
    <>
      <motion.button
        whileTap={{ scale: 0.96 }}
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`More options for ${song.title}`}
        onClick={() => (open ? close() : openWith(0))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            openWith(0);
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            openWith(actions.length - 1);
          }
        }}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-white)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] lg:h-8 lg:w-8 ${open ? 'bg-[var(--glass-bg-hover)] text-[var(--salt-white)]' : ''} ${className}`}
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </motion.button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
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
            className="marea-glass-panel fixed z-[80] overflow-hidden rounded-xl border py-1"
          >
            {actions.map((action, index) => {
              const shared = {
                tabIndex: index === activeIndex ? 0 : -1,
                onMouseEnter: () => setActiveIndex(index),
                className:
                  'flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] text-[var(--salt-white)] transition-colors hover:bg-[var(--glass-bg-hover)] focus:bg-[var(--glass-bg-hover)] focus:outline-none disabled:cursor-wait disabled:opacity-60',
              };
              if (action.href) {
                return (
                  <motion.a
                    whileTap={{ scale: 0.96 }}
                    key={action.key}
                    role="menuitem"
                    {...shared}
                    ref={(node) => {
                      itemsRef.current[index] = node;
                    }}
                    href={action.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => close(false)}
                  >
                    <span className="shrink-0 text-[var(--salt-mist)]">{action.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{action.label}</span>
                  </motion.a>
                );
              }
              return (
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  key={action.key}
                  {...shared}
                  ref={(node) => {
                    itemsRef.current[index] = node;
                  }}
                  type="button"
                  disabled={action.disabled}
                  role={action.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                  aria-checked={action.checked}
                  onClick={() => {
                    action.onSelect?.();
                    if (action.closeOnSelect !== false) close();
                  }}
                >
                  <span className={`shrink-0 ${action.checked ? 'text-[#d84f5f]' : 'text-[var(--salt-mist)]'}`}>
                    {action.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{action.label}</span>
                </motion.button>
              );
            })}
            {stationStatus === 'loading' && (
              <p
                className="border-t border-[var(--glass-border)] px-3 py-2 text-[11px] leading-relaxed text-[var(--salt-mist)]"
                role="status"
              >
                Finding similar full tracks...
              </p>
            )}
            {stationStatus === 'error' && (
              <p
                className="border-t border-[var(--glass-border)] px-3 py-2 text-[11px] leading-relaxed text-[#8a5b19]"
                role="alert"
              >
                The station could not be started. Try again.
              </p>
            )}
          </div>,
          document.body,
        )}
      {playlistDialogOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <AddToPlaylistDialog
            song={song}
            onClose={() => {
              setPlaylistDialogOpen(false);
              triggerRef.current?.focus();
            }}
          />,
          document.body,
        )}
    </>
  );
}
