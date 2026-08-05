import type { ViewType } from '@/types/music';

// First visits should start with discovery, while the album index remains a
// deliberate Library destination.
export const DEFAULT_VIEW: ViewType = 'new';

export const renderableViews = [
  'new',
  'albums',
  'artists',
  'search',
  'favorites',
  'history',
  'playlist',
  'now-playing',
  'pop',
  'jp',
  'billboard',
  'uk',
  'trending',
  'radio',
  'remixes',
  'jazz',
  'classical',
  'sources',
] as const satisfies readonly ViewType[];

const renderableViewSet = new Set<string>(renderableViews);

export type NavigationItem = {
  kind: 'album' | 'artist' | 'track';
  id: string;
};

const itemPattern = /^(album|artist|track):([a-z0-9][a-z0-9._~%\-]{0,127})$/i;

function isProviderItemId(kind: NavigationItem['kind'], id: string): boolean {
  const normalizedId = id.toLowerCase();
  if (kind === 'album' && normalizedId.includes('-artist-')) return false;
  if (kind === 'track' && /-(?:album|artist)-/.test(normalizedId)) return false;

  const prefixes = {
    album: [
      'jamendo-',
      'ccmixter-album-',
      'archive-album-',
      'lxmusic-album-',
      'kuwo-album-',
      'itunes-album-',
      'deezer-album-',
      'audius-album-',
      'openverse-album-',
      'wikimedia-album-',
      'somafm-album-',
      'nts-album-',
      'radioparadise-album-',
      'radio-album-',
    ],
    artist: [
      'jamendo-artist-',
      'ccmixter-artist-',
      'archive-artist-',
      'lxmusic-artist-',
      'kuwo-artist-',
      'itunes-artist-',
      'deezer-artist-',
      'audius-artist-',
      'openverse-artist-',
      'wikimedia-artist-',
      'somafm-artist-',
      'nts-artist-',
      'radioparadise-artist-',
      'radio-artist-',
    ],
    track: [
      'jamendo-',
      'ccmixter-',
      'archive-',
      'lxmusic-',
      'kuwo-',
      'itunes-',
      'deezer-',
      'audius-',
      'openverse-',
      'wikimedia-',
      'somafm-',
      'nts-',
      'radioparadise-',
      'radio-',
    ],
  }[kind];
  return prefixes.some((prefix) => id.toLowerCase().startsWith(prefix));
}

export function parseItem(value: string | null): NavigationItem | null {
  if (!value) return null;
  const match = itemPattern.exec(value);
  if (!match) return null;
  const kind = match[1].toLowerCase() as NavigationItem['kind'];
  const id = match[2];
  return isProviderItemId(kind, id) ? { kind, id } : null;
}

export function parseView(value: string | string[] | null | undefined): ViewType {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === 'jpop') return 'jp';
  return candidate && renderableViewSet.has(candidate) ? (candidate as ViewType) : DEFAULT_VIEW;
}

export function parseNavigation(search: string | URLSearchParams): {
  view: ViewType;
  query: string;
  source: string;
  item: NavigationItem | null;
} {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const view = parseView(params.get('view'));
  const item = parseItem(params.get('item'));
  return {
    view,
    query: view === 'search' ? (params.get('q') ?? '') : '',
    source: view === 'search' ? (params.get('source') ?? '') : '',
    item,
  };
}

export function buildNavigationUrl(
  location: Pick<Location, 'pathname' | 'search' | 'hash'>,
  view: ViewType,
  query = '',
  item: NavigationItem | null = null,
  source = '',
): string {
  const params = new URLSearchParams(location.search);
  params.set('view', view);
  if (view === 'search' && query) params.set('q', query);
  else params.delete('q');
  if (view === 'search' && source) params.set('source', source);
  else params.delete('source');
  if (item) params.set('item', `${item.kind}:${item.id}`);
  else params.delete('item');
  const search = params.toString();
  return `${location.pathname}${search ? `?${search}` : ''}${location.hash}`;
}
