'use client';

import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Clock,
  Heart,
  Globe,
  LayoutGrid,
  Search,
  ListMusic,
  X,
  Disc3,
  AudioWaveform,
  Music2,
  Radio,
  Sparkles,
  Users,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePlayerStore } from '@/store/playerStore';
import type { ViewType } from '@/types/music';
import type { SidebarMode } from '@/lib/appSettings';
import { buildNavigationUrl } from '@/lib/navigation';
import { VirtualList } from '@/components/ui/VirtualList';

interface NavItem {
  view: ViewType;
  label: string;
  icon: ReactNode;
}

function WaveIcon() {
  return (
    <svg width="20" height="12" viewBox="0 0 20 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 6 Q3 1 5 6 Q7 11 9 6 Q11 1 13 6 Q15 11 17 6 Q19 1 20 6" />
    </svg>
  );
}

export const navigationSections: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Library',
    items: [
      { view: 'albums', label: 'Albums', icon: <LayoutGrid className="h-4 w-4" /> },
      { view: 'artists', label: 'Artists', icon: <Users className="h-4 w-4" /> },
      { view: 'playlist', label: 'Playlists', icon: <ListMusic className="h-4 w-4" /> },
      { view: 'favorites', label: 'Favorites', icon: <Heart className="h-4 w-4" /> },
      { view: 'history', label: 'Recently Played', icon: <Clock className="h-4 w-4" /> },
      { view: 'search', label: 'Search', icon: <Search className="h-4 w-4" /> },
    ],
  },
  {
    title: 'Discover',
    items: [
      { view: 'new', label: 'New', icon: <Sparkles className="h-4 w-4" /> },
      { view: 'radio', label: 'Radio', icon: <Radio className="h-4 w-4" /> },
      { view: 'billboard', label: 'US Charts', icon: <BarChart3 className="h-4 w-4" /> },
      { view: 'uk', label: 'UK Charts', icon: <BarChart3 className="h-4 w-4" /> },
      { view: 'jp', label: 'Japan Charts', icon: <Disc3 className="h-4 w-4" /> },
    ],
  },
  {
    title: 'Explore',
    items: [
      { view: 'remixes', label: 'Remixes', icon: <Disc3 className="h-4 w-4" /> },
      { view: 'jazz', label: 'Jazz', icon: <AudioWaveform className="h-4 w-4" /> },
      { view: 'classical', label: 'Classical', icon: <Music2 className="h-4 w-4" /> },
      { view: 'sources', label: 'Sources', icon: <Globe className="h-4 w-4" /> },
    ],
  },
];

function NavSections({
  onSelect,
  onNavigate,
  collapsed = false,
}: {
  onSelect?: () => void;
  onNavigate?: (view: ViewType) => void;
  collapsed?: boolean;
}) {
  const currentView = usePlayerStore((state) => state.currentView);
  const setCurrentView = usePlayerStore((state) => state.setCurrentView);

  const navigate = useCallback(
    (view: ViewType) => {
      if (onNavigate) {
        onNavigate(view);
        return;
      }
      setCurrentView(view);
      window.history.pushState(null, '', buildNavigationUrl(window.location, view));
    },
    [onNavigate, setCurrentView],
  );

  const entries = navigationSections.flatMap((section) => [
    { kind: 'section' as const, id: `section-${section.title}`, title: section.title },
    ...section.items.map((item) => ({ kind: 'item' as const, id: item.view, item })),
  ]);

  return (
    <VirtualList
      items={entries}
      estimateSize={collapsed ? 40 : 36}
      label="Primary navigation"
      getItemKey={(entry) => entry.id}
      style={{ height: '100%' }}
      className="overflow-x-hidden"
      renderItem={(entry) => {
        if (entry.kind === 'section') {
          return (
            <p
              className={
                collapsed
                  ? 'h-3 px-1 text-center text-[0px] text-transparent'
                  : 'h-7 px-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--salt-mist)]'
              }
              aria-hidden={collapsed}
            >
              {collapsed ? '' : entry.title}
            </p>
          );
        }

        const active = currentView === entry.item.view;
        return (
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              navigate(entry.item.view);
              onSelect?.();
            }}
            className={`flex h-9 w-full items-center rounded-md text-[13px] font-medium transition-colors ${collapsed ? 'justify-center px-0' : 'gap-2.5 px-2'} ${active ? 'marea-nav-item-active text-[var(--salt-primary)]' : 'text-[var(--salt-foam)] hover:bg-[var(--glass-bg-hover)]'}`}
            aria-current={active ? 'page' : undefined}
            aria-label={collapsed ? entry.item.label : undefined}
            title={collapsed ? entry.item.label : undefined}
          >
            {entry.item.icon}
            <span className={collapsed ? 'sr-only' : 'truncate'}>{entry.item.label}</span>
          </motion.button>
        );
      }}
    />
  );
}

export function Sidebar({
  onNavigate,
  mode = 'expanded',
  onToggle,
}: {
  onNavigate?: (view: ViewType) => void;
  mode?: SidebarMode;
  onToggle?: () => void;
}) {
  const collapsed = mode === 'collapsed';
  return (
    <aside
      aria-label="Sidebar navigation"
      className={`marea-glass-sidebar hidden h-dvh shrink-0 flex-col border-r transition-[width] duration-300 md:flex ${collapsed ? 'w-[72px]' : 'w-[248px]'}`}
    >
      <div className={`pb-4 pt-6 ${collapsed ? 'px-2' : 'px-4'}`}>
        <div className={`flex items-center text-[var(--salt-white)] ${collapsed ? 'justify-center' : 'gap-2.5 px-2'}`}>
          <span className="marea-glass-control flex h-7 w-7 items-center justify-center rounded-lg border text-[var(--salt-primary)]">
            <WaveIcon />
          </span>
          {!collapsed && <span className="text-[19px] font-bold tracking-[-0.02em]">Marea</span>}
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={onToggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`marea-glass-control flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-[var(--salt-mist)] hover:text-[var(--salt-primary)] ${collapsed ? 'mt-3' : 'ml-auto'}`}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" aria-hidden />
            ) : (
              <ChevronLeft className="h-4 w-4" aria-hidden />
            )}
          </motion.button>
        </div>
      </div>
      <nav className={`flex flex-1 flex-col gap-4 overflow-y-auto pb-6 ${collapsed ? 'px-2' : 'px-2'}`}>
        <NavSections onNavigate={onNavigate} collapsed={collapsed} />
      </nav>
    </aside>
  );
}

export function MobileNavigation({ onNavigate }: { onNavigate?: (view: ViewType) => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const closeNavigation = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeNavigation();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (!dialogRef.current?.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    const desktopQuery = window.matchMedia('(min-width: 768px)');
    const handleDesktopTransition = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    desktopQuery.addEventListener('change', handleDesktopTransition);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      desktopQuery.removeEventListener('change', handleDesktopTransition);
    };
  }, [closeNavigation, open]);

  const navigationDialog = open ? (
    <div
      ref={dialogRef}
      id="mobile-navigation-dialog"
      className="fixed inset-0 z-[70] md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation menu"
    >
      <button
        tabIndex={-1}
        aria-label="Close navigation"
        onClick={closeNavigation}
        className="absolute inset-0 bg-[rgba(13,43,62,0.34)] backdrop-blur-sm"
      />
      <div className="marea-glass-sidebar absolute inset-y-0 left-0 flex w-[min(86vw,320px)] flex-col border-r p-2 shadow-[18px_0_60px_rgba(25,74,102,0.2)]">
        <div className="flex shrink-0 items-center justify-between px-2 pb-3 pt-2">
          <div className="flex items-center gap-2.5 text-[19px] font-bold text-[var(--salt-white)]">
            <span className="marea-glass-control flex h-7 w-7 items-center justify-center rounded-lg border text-[var(--salt-primary)]">
              <WaveIcon />
            </span>
            Marea
          </div>
          <motion.button
            whileTap={{ scale: 0.96 }}
            ref={closeButtonRef}
            onClick={closeNavigation}
            aria-label="Close navigation"
            className="marea-glass-control flex h-9 w-9 items-center justify-center rounded-full border text-[var(--salt-mist)]"
          >
            <X className="h-5 w-5" />
          </motion.button>
        </div>
        <nav className="min-h-0 flex-1">
          <NavSections onSelect={closeNavigation} onNavigate={onNavigate} />
        </nav>
      </div>
    </div>
  ) : null;

  return (
    <>
      <motion.button
        whileTap={{ scale: 0.96 }}
        ref={triggerRef}
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        aria-controls="mobile-navigation-dialog"
        className="marea-glass-control flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border text-[var(--salt-white)] md:hidden"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </motion.button>
      {open && typeof document !== 'undefined' ? createPortal(navigationDialog, document.body) : null}
    </>
  );
}
