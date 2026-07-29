import { describe, expect, it } from 'vitest';
import type { Song } from '@/types/music';
import {
  areAllSearchProvidersUnavailable,
  rankSearchSongs,
  rankSearchSongsForAccess,
  splitTopSearchMatches,
} from './searchViewModel';

function song(id: string, overrides: Partial<Song> = {}): Song {
  return {
    id,
    title: 'Cruel Summer',
    artist: 'Taylor Swift',
    artistId: 'artist-1',
    album: 'Lover',
    albumId: 'album-1',
    coverArt: '/placeholder-album.svg',
    duration: 210,
    track: 1,
    year: 2019,
    genre: 'Pop',
    path: `/music/${id}.mp3`,
    bitRate: 320,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: 1,
    provider: 'Audius',
    sourceUrl: 'https://example.com/source',
    creatorUrl: 'https://example.com/artist',
    licenseName: 'Creator-published stream',
    licenseUrl: 'https://example.com/license',
    attributionUrl: 'https://example.com/source',
    metadataVerified: true,
    ...overrides,
  };
}

describe('search view model', () => {
  it('prioritizes an exact artist match over an unrelated track named after the artist', () => {
    const namedAfterArtist = song('audius-title', { title: 'Taylor Swift', artist: 'Someone Else' });
    const officialArtistMatch = song('itunes-artist', { provider: 'Apple Preview', duration: 30 });

    expect(rankSearchSongs([namedAfterArtist, officialArtistMatch], 'Taylor Swift').map(({ id }) => id)).toEqual([
      'itunes-artist',
      'audius-title',
    ]);
  });

  it('keeps the higher-confidence provider when sources return the same track identity', () => {
    const upload = song('audius-upload', { title: 'Cruel Summer [ic8j13piAhQ]' });
    const official = song('itunes-official', { provider: 'Apple Preview', duration: 30 });

    expect(rankSearchSongs([upload, official], 'Cruel Summer').map(({ id }) => id)).toEqual(['itunes-official']);
  });

  it('filters access before deduplicating equivalent full tracks and previews', () => {
    const upload = song('audius-upload', { title: 'Cruel Summer [ic8j13piAhQ]' });
    const official = song('itunes-official', { provider: 'Apple Preview', duration: 30 });

    expect(rankSearchSongsForAccess([upload, official], 'Cruel Summer', 'full').map(({ id }) => id)).toEqual([
      'audius-upload',
    ]);
    expect(rankSearchSongsForAccess([upload, official], 'Cruel Summer', 'preview').map(({ id }) => id)).toEqual([
      'itunes-official',
    ]);
  });

  it('keeps every ranked track while separating a compact top-results shelf', () => {
    const songs = Array.from({ length: 8 }, (_, index) => song(`track-${index}`, { title: `Track ${index}` }));

    expect(splitTopSearchMatches(songs, 3)).toEqual({
      topMatches: songs.slice(0, 3),
      remainingTracks: songs.slice(3),
    });
  });

  it('counts degraded providers when every search source is unavailable', () => {
    expect(
      areAllSearchProvidersUnavailable({
        results: [],
        failedProviders: ['Audius'],
        degradedProviders: ['ccMixter'],
        providerCount: 2,
      }),
    ).toBe(true);
    expect(
      areAllSearchProvidersUnavailable({
        results: [song('healthy-result')],
        failedProviders: ['Audius'],
        degradedProviders: ['ccMixter'],
        providerCount: 2,
      }),
    ).toBe(false);
  });
});
