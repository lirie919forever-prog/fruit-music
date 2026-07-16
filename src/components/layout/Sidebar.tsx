'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import type { ViewType } from '@/types/music';
import { HiMagnifyingGlass, HiXMark } from 'react-icons/hi2';
import { TbVinyl, TbWaveSine } from 'react-icons/tb';
import { GiViolin } from 'react-icons/gi';

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

function IconPop() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 1l1.5 3.5L13 5l-2.5 2.5.5 3.5L8 9.5 5 11l.5-3.5L3 5l3.5-.5z" /></svg>;
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
    { view: 'search', label: 'Search', icon: <HiMagnifyingGlass className="h-4 w-4" /> },
  ] },
  { title: 'Discover', items: [
    { view: 'pop', label: 'Pop', icon: <IconPop /> },
    { view: 'jp', label: 'J-Pop', icon: <IconJpop /> },
    { view: 'trending', label: 'Trending', icon: <IconTrending /> },
  ] },
  { title: 'Explore', items: [
    { view: 'remixes', label: 'Remixes', icon: <TbVinyl className="h-4 w-4" /> },
    { view: 'jazz', label: 'Jazz', icon: <TbWaveSine className="h-4 w-4" /> },
    { view: 'classical', label: 'Classical', icon: <GiViolin className="h-4 w-4" /> },
  ] },
];

function NavSections({ onSelect }: { onSelect?: () => void }) {
  const currentView = usePlayerStore((state) => state.currentView);
  const setCurrentView = usePlayerStore((state) => state.setCurrentView);

  return navigationSections.map((section) => (
    <div key={section.title} className="space-y-1">
      <p className="px-3 pb-2 pt-5 text-[13px] font-semibold uppercase tracking-[0.18em] text-[var(--salt-mist)]">{section.title}</p>
      {section.items.map((item) => {
        const active = currentView === item.view;
        return (
          <button
            key={item.view}
            onClick={() => { setCurrentView(item.view); onSelect?.(); }}
            className="flex h-10 w-full items-center gap-3 rounded-2xl border px-3 text-sm transition-colors"
            style={{
              color: active ? 'var(--salt-white)' : 'var(--salt-mist)',
              background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
              borderColor: active ? 'var(--glass-border-active)' : 'transparent',
            }}
            aria-current={active ? 'page' : undefined}
          >
            {item.icon}<span className="font-medium">{item.label}</span>
          </button>
        );
      })}
    </div>
  ));
}

export function Sidebar() {
  return (
    <aside className="hidden h-dvh w-[220px] shrink-0 border-r border-[var(--glass-border)] bg-[rgba(2,8,16,0.7)] backdrop-blur-2xl md:flex md:flex-col">
      <div className="px-4 pb-5 pt-6"><div className="flex items-center gap-3 text-[var(--salt-white)]"><span className="text-[var(--salt-primary)]"><WaveIcon /></span><span className="text-xl font-bold tracking-tight">Marea</span></div></div>
      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-2 pb-6"><NavSections /></nav>
    </aside>
  );
}

export function MobileNavigation() {
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
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeNavigation();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeNavigation, open]);

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        aria-controls="mobile-navigation-dialog"
        className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--salt-white)] md:hidden"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      {open && (
        <div ref={dialogRef} id="mobile-navigation-dialog" className="fixed inset-0 z-[70] md:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <button tabIndex={-1} aria-label="Close navigation" onClick={closeNavigation} className="absolute inset-0 bg-[rgba(2,8,16,0.72)] backdrop-blur-sm" />
          <div className="absolute inset-y-0 left-0 w-[min(86vw,320px)] overflow-y-auto border-r border-[var(--glass-border)] bg-[var(--sea-midnight)] p-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2"><div className="flex items-center gap-3 text-xl font-bold"><span className="text-[var(--salt-primary)]"><WaveIcon /></span>Marea</div><button ref={closeButtonRef} onClick={closeNavigation} aria-label="Close navigation" className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--salt-mist)]"><HiXMark className="h-6 w-6" /></button></div>
            <nav className="space-y-4"><NavSections onSelect={closeNavigation} /></nav>
          </div>
        </div>
      )}
    </>
  );
}
