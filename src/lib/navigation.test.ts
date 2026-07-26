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
    expect(parseView('now_playing')).toBe('albums');
  });

  it('renders the playlist view now that playlists exist', () => {
    expect(parseView('playlist')).toBe('playlist');
  });

  it('accepts the J-Pop alias and canonicalizes it to jp', () => {
    expect(parseView('jpop')).toBe('jp');
    expect(parseNavigation('?view=jpop')).toMatchObject({ view: 'jp', item: null });
  });

  it('parses compatible item identities and rejects incompatible ones', () => {
    expect(parseNavigation('?view=now-playing&item=track%3Ajamendo-123')).toMatchObject({
      view: 'now-playing',
      item: { kind: 'track', id: 'jamendo-123' },
    });
    expect(parseNavigation('?view=jp&item=track%3Ajamendo-123').item).toEqual({ kind: 'track', id: 'jamendo-123' });
    expect(parseNavigation('?view=albums&item=album%3Ajamendo-123').item).toEqual({ kind: 'album', id: 'jamendo-123' });
    expect(parseNavigation('?view=now-playing&item=track%3A%2Fbad').item).toBeNull();
    expect(parseNavigation('?view=now-playing&item=track%3Aother-123').item).toBeNull();
  });

  // A shared link to an Apple album or artist is only as good as this list: an
  // id whose prefix is missing here parses to null, and the page silently
  // reopens the grid instead of the record the link named.
  it('parses the Apple catalog identities the deep links now produce', () => {
    expect(parseNavigation('?view=albums&item=album%3Aitunes-album-1161503945').item).toEqual({
      kind: 'album',
      id: 'itunes-album-1161503945',
    });
    expect(parseNavigation('?view=artists&item=artist%3Aitunes-artist-479756766').item).toEqual({
      kind: 'artist',
      id: 'itunes-artist-479756766',
    });
    expect(parseNavigation('?view=now-playing&item=track%3Aitunes-1440872304').item).toEqual({
      kind: 'track',
      id: 'itunes-1440872304',
    });
    // An album id is not an artist id, and the artist route must not accept one.
    expect(parseNavigation('?view=artists&item=artist%3Aitunes-album-1161503945').item).toBeNull();
  });
});

describe('navigation URL updates', () => {
  const location = { pathname: '/', search: '?campaign=summer&q=old', hash: '#tracks' } as Location;

  it('preserves unrelated URL state and removes stale search text', () => {
    expect(buildNavigationUrl(location, 'artists')).toBe('/?campaign=summer&view=artists#tracks');
  });

  it('writes a compatible item identity', () => {
    expect(buildNavigationUrl(location, 'albums', '', { kind: 'album', id: 'jamendo-123' })).toBe(
      '/?campaign=summer&view=albums&item=album%3Ajamendo-123#tracks',
    );
  });

  it('writes the current search text', () => {
    expect(buildNavigationUrl(location, 'search', 'blue sea')).toBe('/?campaign=summer&q=blue+sea&view=search#tracks');
  });
});
