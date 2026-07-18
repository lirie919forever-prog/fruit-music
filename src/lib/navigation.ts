import type { ViewType } from '@/types/music';

export const DEFAULT_VIEW: ViewType = 'albums';

export const renderableViews = [
  'albums',
  'artists',
  'search',
  'favorites',
  'history',
  'now-playing',
  'pop',
  'jp',
  'trending',
  'remixes',
  'jazz',
  'classical',
] as const satisfies readonly ViewType[];

const renderableViewSet = new Set<string>(renderableViews);

export function parseView(value: string | string[] | null | undefined): ViewType {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && renderableViewSet.has(candidate) ? candidate as ViewType : DEFAULT_VIEW;
}

export function parseNavigation(search: string | URLSearchParams): { view: ViewType; query: string } {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const view = parseView(params.get('view'));
  return { view, query: view === 'search' ? params.get('q') ?? '' : '' };
}

export function buildNavigationUrl(location: Pick<Location, 'pathname' | 'search' | 'hash'>, view: ViewType, query = ''): string {
  const params = new URLSearchParams(location.search);
  params.set('view', view);
  if (view === 'search' && query) params.set('q', query);
  else params.delete('q');
  const search = params.toString();
  return `${location.pathname}${search ? `?${search}` : ''}${location.hash}`;
}
