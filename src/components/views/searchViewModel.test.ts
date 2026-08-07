import { describe, expect, it } from 'vitest';
import type { Album, Artist, Song } from '@/types/music';
import {
  areAllSearchProvidersUnavailable,
  rankSearchAlbums,
  rankSearchArtists,
  rankSearchSongs,
  rankSearchSongsForAccess,
  splitTopSearchMatches,
  summarizeSearchProviders,
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

function artist(id: string, name: string): Artist {
  return { id, name, coverArt: '/placeholder-album.svg', albumCount: 1 };
}

function album(id: string, name: string, artistName: string): Album {
  return {
    id,
    name,
    artist: artistName,
    artistId: `${id}-artist`,
    coverArt: '/placeholder-album.svg',
    songCount: 10,
    duration: 1_800,
    year: 2024,
    genre: 'Pop',
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

  it('prioritizes an exact song title over a track whose artist has that name', () => {
    const artistNameCollision = song('audius-collision', {
      title: 'Suicide Blonde',
      artist: 'Blinding Lights',
    });
    const exactTitle = song('itunes-blinding-lights', {
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      provider: 'Apple Preview',
      duration: 30,
    });

    expect(rankSearchSongs([artistNameCollision, exactTitle], 'Blinding Lights').map(({ id }) => id)).toEqual([
      'itunes-blinding-lights',
      'audius-collision',
    ]);
  });

  it('keeps an exact Japanese artist above a noisy title prefix from another artist', () => {
    const noisyTitle = song('kuwo-noisy', {
      title: 'YOASOBI小说歌者100%的灵魂传递',
      artist: '乐见大牌&YOASOBI',
      provider: 'Kuwo',
      metadataVerified: false,
    });
    const exactArtist = song('kuwo-exact-artist', {
      title: '怪物',
      artist: 'YOASOBI',
      provider: 'Kuwo',
      metadataVerified: false,
    });

    expect(rankSearchSongs([noisyTitle, exactArtist], 'YOASOBI').map(({ id }) => id)).toEqual([
      'kuwo-exact-artist',
      'kuwo-noisy',
    ]);
  });

  it('prefers a resolver track by the exact artist over a resolver title named after that artist', () => {
    const titleCollision = song('kuwo-title-collision', {
      title: 'YOASOBI',
      artist: 'Fan upload',
      provider: 'Kuwo',
      metadataVerified: false,
    });
    const exactArtist = song('kuwo-exact-artist-recording', {
      title: 'Monster',
      artist: 'YOASOBI',
      provider: 'Kuwo',
      metadataVerified: false,
    });

    expect(rankSearchSongs([titleCollision, exactArtist], 'YOASOBI').map(({ id }) => id)).toEqual([
      'kuwo-exact-artist-recording',
      'kuwo-title-collision',
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

  it('prefers the full recording when all-audio results contain the same preview', () => {
    const preview = song('itunes-preview', { provider: 'Apple Preview', duration: 30 });
    const fullRecording = song('audius-full', { provider: 'Audius' });

    expect(rankSearchSongsForAccess([preview, fullRecording], 'Cruel Summer', 'all').map(({ id }) => id)).toEqual([
      'audius-full',
    ]);
  });

  it('presents full-length resolver matches alongside direct full tracks in full mode', () => {
    // Different titles so they don't deduplicate as the same recording.
    const direct = song('audius-direct', { provider: 'Audius', title: 'Direct Song' });
    const resolverMatch = song('kuwo-match', { provider: 'Kuwo', duration: 241, title: 'Resolver Song' });

    // Both are now included in 'full' mode: the Kuwo track has a full-track
    // duration (241s >= 45s minimum) and the playback system handles resolver
    // resolution with fallbacks. Hiding it from searches showed users only
    // covers instead of the real track.
    const fullResults = rankSearchSongsForAccess([resolverMatch, direct], 'Resolver Song', 'full').map(({ id }) => id);
    expect(fullResults).toContain('audius-direct');
    expect(fullResults).toContain('kuwo-match');
    expect(rankSearchSongsForAccess([resolverMatch, direct], 'Resolver Song', 'preview')).toEqual([]);
    const allResults = rankSearchSongsForAccess([resolverMatch, direct], 'Resolver Song', 'all').map(({ id }) => id);
    expect(allResults).toContain('audius-direct');
    expect(allResults).toContain('kuwo-match');
  });

  it('does not present obvious short Audius clips as search results', () => {
    const ringtone = song('audius-ringtone', {
      title: 'YOASOBI - Yoru ni Kakeru (iPhone ringtone version)',
      artist: 'lasuah8',
      duration: 35,
    });
    const fullTrack = song('kuwo-full', {
      title: '夜に駆ける',
      artist: 'YOASOBI',
      provider: 'Kuwo',
      duration: 261,
    });

    expect(rankSearchSongsForAccess([ringtone, fullTrack], 'YOASOBI', 'full').map(({ id }) => id)).toEqual([
      'kuwo-full',
    ]);
    expect(rankSearchSongsForAccess([ringtone, fullTrack], 'YOASOBI', 'all').map(({ id }) => id)).toEqual([
      'kuwo-full',
    ]);
  });

  it('keeps every ranked track while separating a compact top-results shelf', () => {
    const songs = Array.from({ length: 8 }, (_, index) => song(`track-${index}`, { title: `Track ${index}` }));

    expect(splitTopSearchMatches(songs, 3)).toEqual({
      topMatches: songs.slice(0, 3),
      remainingTracks: songs.slice(3),
    });
  });

  it('deduplicates provider artist records and keeps the strongest exact match', () => {
    const artists = [
      artist('jamendo-artist-1', 'Taylor Swift'),
      artist('itunes-artist-2', 'Taylor Swift'),
      artist('audius-artist-3', 'Taylor Swift fan edits'),
    ];

    expect(rankSearchArtists(artists, 'Taylor Swift').map(({ id }) => id)).toEqual([
      'itunes-artist-2',
      'audius-artist-3',
    ]);
  });

  it('collapses duplicate album records without merging different releases', () => {
    const albums = [
      album('jamendo-album-1', 'Lover', 'Taylor Swift'),
      album('itunes-album-2', 'Lover', 'Taylor Swift'),
      album('itunes-album-3', '1989', 'Taylor Swift'),
    ];

    expect(rankSearchAlbums(albums, 'Taylor Swift').map(({ id }) => id)).toEqual(['itunes-album-2', 'itunes-album-3']);
  });

  it('summarizes result, empty, partial, and unavailable search sources', () => {
    const summaries = summarizeSearchProviders(
      ['Audius', 'Jamendo', 'ccMixter', 'Archive'],
      [song('audius-result')],
      ['Archive'],
      ['ccMixter'],
    );

    expect(summaries).toEqual([
      { name: 'Audius', resultCount: 1, status: 'results' },
      { name: 'Jamendo', resultCount: 0, status: 'no-match' },
      { name: 'ccMixter', resultCount: 0, status: 'partial' },
      { name: 'Archive', resultCount: 0, status: 'unavailable' },
    ]);
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
