'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import type { ViewType } from '@/types/music';
import { buildNavigationUrl } from '@/lib/navigation';
import { HiMagnifyingGlass, HiQueueList, HiXMark } from 'react-icons/hi2';
import { TbVinyl, TbWaveSine } from 'react-icons/tb';
import { GiViolin } from 'react-icons/gi';

function IconSparkles() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m8 1 1.2 4.8L14 7l-4.8 1.2L8 13l-1.2-4.8L2 7l4.8-1.2L8 1Z" /><path d="m13 11 .4 1.6L15 13l-1.6.4L13 15l-.4-1.6L11 13l1.6-.4L13 11Z" /></svg>;
}

interface NavItem {
  view: ViewType;
  label: string;
  icon: ReactNode;
}

function IconAlbums() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="1" width="6" height="6" rx="1.5" /><rect x="9" y="1" width="6" height="6" rx="1.5" /><rect x="1" y="9" width="6" height="6" rx="1.5" /><rect x="9" y="9" width="6" height="6" rx="1.5" /></svg>;
}

function IconArtists() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="5" r="3" /><path d="M2 14c0-3.314 2.686-5 6-5s6 1.686 6 5" /></svg>;
}

function IconJpop() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6" /><circle cx="8" cy="8" r="2" /><path d="M8 2v2M8 12v2M2 8h2M12 8h2" /></svg>;
}

function IconTrending() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="1,12 5,7 9,9 15,3" /><polyline points="11,3 15,3 15,7" /></svg>;
}

function WaveIcon() {
  return <svg width="20" height="12" viewBox="0 0 20 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 6 Q3 1 5 6 Q7 11 9 6 Q11 1 13 6 Q15 11 17 6 Q19 1 20 6" /></svg>;
}

export const navigationSections: Array<{ title: string; items: NavItem[] }> = [
  { title: 'Library', items: [
    { view: 'albums', label: 'Albums', icon: <IconAlbums /> },
    { view: 'artists', label: 'Artists', icon: <IconArtists /> },
    { view: 'playlist', label: 'Playlists', icon: <HiQueueList className="h-4 w-4" /> },
    { view: 'favorites', label: 'Favorites', icon: <span aria-hidden>♥</span> },
    { view: 'history', label: 'Recently Played', icon: <span aria-hidden>◷</span> },
    { view: 'search', label: 'Search', icon: <HiMagnifyingGlass className="h-4 w-4" /> },
  ] },
  { title: 'Discover', items: [
    { view: 'new', label: 'New', icon: <IconSparkles /> },
    { view: 'billboard', label: 'US Charts', icon: <IconTrending /> },
    { view: 'uk', label: 'UK Charts', icon: <IconTrending /> },
    { view: 'jp', label: 'Japan Charts', icon: <IconJpop /> },
  ] },
  { title: 'Explore', items: [
    { view: 'remixes', label: 'Remixes', icon: <TbVinyl className="h-4 w-4" /> },
    { view: 'jazz', label: 'Jazz', icon: <TbWaveSine className="h-4 w-4" /> },
    { view: 'classical', label: 'Classical', icon: <GiViolin className="h-4 w-4" /> },
  ] },
];

function NavSections({ onSelect, onNavigate }: { onSelect?: () => void; onNavigate?: (view: ViewType) => void }) {
  const currentView = usePlayerStore((state) => state.currentView);
  const setCurrentView = usePlayerStore((state) => state.setCurrentView);

  const navigate = useCallback((view: ViewType) => {
    if (onNavigate) {
      onNavigate(view);
      return;
    }
    setCurrentView(view);
    window.history.pushState(null, '', buildNavigationUrl(window.location, view));
  }, [onNavigate, setCurrentView]);

  return navigationSections.map((section) => (
    <div key={section.title}>
      <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--salt-mist)]">{section.title}</p>
      {section.items.map((item) => {
        const active = currentView === item.view;
        return (
          <button
            key={item.view}
            onClick={() => { navigate(item.view); onSelect?.(); }}
            className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] font-medium transition-colors ${active ? 'bg-[rgba(212,235,248,0.9)] text-[var(--salt-primary)]' : 'text-[var(--salt-foam)] hover:bg-[var(--glass-bg-hover)]'}`}
            aria-current={active ? 'page' : undefined}
          >
            {item.icon}<span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </div>
  ));
}

export function Sidebar({ onNavigate }: { onNavigate?: (view: ViewType) => void }) {
  return (
    <aside className="hidden h-dvh w-[248px] shrink-0 border-r border-[var(--glass-border)] bg-[#f3f8fb] md:flex md:flex-col">
      <div className="px-4 pb-4 pt-6"><div className="flex items-center gap-2.5 px-2 text-[var(--salt-white)]"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[var(--salt-primary)] shadow-[0_1px_3px_rgba(48,145,198,0.18)]"><WaveIcon /></span><span className="text-[19px] font-bold tracking-[-0.02em]">Marea</span></div></div>
      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-2 pb-6"><NavSections onNavigate={onNavigate} /></nav>
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

      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []).filter((element) => element.offsetParent !== null);
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

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        aria-controls="mobile-navigation-dialog"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--glass-border)] bg-white text-[var(--salt-white)] md:hidden"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      {open && (
        <div ref={dialogRef} id="mobile-navigation-dialog" className="fixed inset-0 z-[70] md:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <button tabIndex={-1} aria-label="Close navigation" onClick={closeNavigation} className="absolute inset-0 bg-[rgba(13,43,62,0.34)] backdrop-blur-sm" />
          <div className="absolute inset-y-0 left-0 w-[min(86vw,320px)] overflow-y-auto border-r border-[var(--glass-border)] bg-[#f3f8fb] p-2 shadow-[18px_0_60px_rgba(25,74,102,0.2)]">
            <div className="flex items-center justify-between px-2 pb-3 pt-2"><div className="flex items-center gap-2.5 text-[19px] font-bold text-[var(--salt-white)]"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[var(--salt-primary)]"><WaveIcon /></span>Marea</div><button ref={closeButtonRef} onClick={closeNavigation} aria-label="Close navigation" className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--salt-mist)] hover:bg-[var(--glass-bg-hover)]"><HiXMark className="h-5 w-5" /></button></div>
            <nav className="flex flex-col gap-4"><NavSections onSelect={closeNavigation} onNavigate={onNavigate} /></nav>
          </div>
        </div>
      )}
    </>
  );
}
