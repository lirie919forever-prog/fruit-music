'use client';

import { BarChart3, Clock, Globe, Heart, LayoutGrid, Search, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { buildNavigationUrl } from '@/lib/navigation';
import type { ViewType } from '@/types/music';

/**
 * Pure navigation presentational pieces split out of NewView so the discovery
 * page file stays focused on catalogue wiring. These have no discovery-filter
 * coupling and no circular dependency back into NewView.
 */
export function navigateTo(view: ViewType): void {
  window.history.pushState(null, '', buildNavigationUrl(window.location, view));
}

export function ExploreGrid() {
  const setCurrentView = usePlayerStore((state) => state.setCurrentView);
  const navigate = (view: ViewType) => {
    navigateTo(view);
    setCurrentView(view);
  };
  const items: Array<{ view: ViewType; icon: ReactNode; label: string }> = [
    { view: 'albums', icon: <LayoutGrid />, label: 'Albums' },
    { view: 'artists', icon: <Users />, label: 'Artists' },
    { view: 'search', icon: <Search />, label: 'Search' },
    { view: 'favorites', icon: <Heart className="fill-current" />, label: 'Favorites' },
    { view: 'history', icon: <Clock />, label: 'History' },
    { view: 'billboard', icon: <BarChart3 />, label: 'Charts' },
    { view: 'jp', icon: <Globe />, label: 'J-Pop' },
    { view: 'sources', icon: <Globe />, label: 'Sources' },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(({ view, icon, label }) => (
        <button
          key={view}
          type="button"
          onClick={() => navigate(view)}
          className="marea-glass-card flex h-12 items-center gap-2.5 rounded-lg border px-3 text-left text-[13px] font-semibold text-[var(--salt-white)]"
        >
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#eaf4f7] text-[var(--salt-primary)]"
            aria-hidden
          >
            {icon}
          </span>
          <span className="truncate">{label}</span>
        </button>
      ))}
    </div>
  );
}
