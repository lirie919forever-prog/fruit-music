import { describe, expect, it } from 'vitest';
import { buildNavigationUrl, parseNavigation, parseView } from '@/lib/navigation';

describe('navigation parsing', () => {
  it('accepts every rendered view', () => {
    expect(parseView('artists')).toBe('artists');
    expect(parseView('now-playing')).toBe('now-playing');
    expect(parseView('classical')).toBe('classical');
  });

  it('defaults missing, invalid, and unsupported views to albums', () => {
    expect(parseView(undefined)).toBe('albums');
    expect(parseView('unknown')).toBe('albums');
    expect(parseView('playlist')).toBe('albums');
  });

  it('reads search text only for the search view', () => {
    expect(parseNavigation('?view=search&q=ocean')).toEqual({ view: 'search', query: 'ocean' });
    expect(parseNavigation('?view=artists&q=ocean')).toEqual({ view: 'artists', query: '' });
  });
});

describe('navigation URL updates', () => {
  const location = { pathname: '/', search: '?campaign=summer&q=old', hash: '#tracks' } as Location;

  it('preserves unrelated URL state and removes stale search text', () => {
    expect(buildNavigationUrl(location, 'artists')).toBe('/?campaign=summer&view=artists#tracks');
  });

  it('writes the current search text', () => {
    expect(buildNavigationUrl(location, 'search', 'blue sea')).toBe('/?campaign=summer&q=blue+sea&view=search#tracks');
  });
});
