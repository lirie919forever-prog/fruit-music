import { describe, expect, it } from 'vitest';
import type { Song } from '@/types/music';
import {
  buildDiscoveryMixForAccess,
  buildListeningMix,
  buildListeningMixForAccess,
  buildStationQueue,
  filterEntitiesByAccess,
  filterSongsByAccess,
  isDirectFullTrack,
  isCuratableTitle,
  isFullTrack,
  isSearchableSong,
  interleaveSongGroups,
  interleaveSongsByProvider,
  playableSongs,
  selectSongsByAccess,
  uniqueAlbumSongs,
} from './newViewModel';

function song(id: string, albumId = `album-${id}`, playbackUnavailable = false): Song {
  return {
    id,
    title: id,
    artist: 'Artist',
    artistId: 'artist-1',
    album: albumId,
    albumId,
    coverArt: '/placeholder-album.svg',
    duration: 120,
    track: 1,
    year: 2026,
    genre: 'pop',
    path: `/music/${id}.mp3`,
    bitRate: 320,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: 1,
    provider: 'Jamendo',
    sourceUrl: 'https://example.com/source',
    creatorUrl: 'https://example.com/artist',
    licenseName: 'CC BY',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attributionUrl: 'https://example.com/source',
    metadataVerified: true,
    playbackUnavailable,
  };
}

function providerSong(id: string, provider: Song['provider']): Song {
  return { ...song(id), provider };
}

describe('New view model', () => {
  it('interleaves sources while preserving source order and removing duplicate IDs', () => {
    expect(
      interleaveSongGroups([
        [song('a1'), song('a2')],
        [song('b1'), song('a2'), song('b3')],
      ]),
    ).toEqual([song('a1'), song('b1'), song('a2'), song('b3')]);
  });

  it('limits results after interleaving', () => {
    expect(interleaveSongGroups([[song('a1'), song('a2')], [song('b1')]], 2).map(({ id }) => id)).toEqual(['a1', 'b1']);
  });

  it('keeps providers mixed after several shelves finish loading', () => {
    const groups = [
      [
        providerSong('apple-1', 'Apple Preview'),
        providerSong('deezer-1', 'Deezer Preview'),
        providerSong('audius-1', 'Audius'),
        providerSong('jamendo-1', 'Jamendo'),
      ],
      [
        providerSong('apple-2', 'Apple Preview'),
        providerSong('deezer-2', 'Deezer Preview'),
        providerSong('audius-2', 'Audius'),
        providerSong('jamendo-2', 'Jamendo'),
      ],
      [
        providerSong('apple-3', 'Apple Preview'),
        providerSong('deezer-3', 'Deezer Preview'),
        providerSong('audius-3', 'Audius'),
        providerSong('jamendo-3', 'Jamendo'),
      ],
    ];

    expect(interleaveSongsByProvider(groups, 6).map(({ id }) => id)).toEqual([
      'apple-1',
      'deezer-1',
      'audius-1',
      'jamendo-1',
      'apple-2',
      'deezer-2',
    ]);
  });

  it('separates playable tracks and deduplicates album representatives', () => {
    const unknownAlbum = song('unknown', 'album-unknown');
    unknownAlbum.album = 'Unknown';
    const songs = [song('a1', 'album-a'), song('a2', 'album-a'), song('b1', 'album-b', true), unknownAlbum];
    expect(playableSongs(songs).map(({ id }) => id)).toEqual(['a1', 'a2', 'unknown']);
    expect(uniqueAlbumSongs(songs).map(({ id }) => id)).toEqual(['a1', 'b1']);
  });

  it('lets discovery distinguish full tracks from official previews', () => {
    const applePreview = song('apple-preview');
    applePreview.provider = 'Apple Preview';
    const deezerPreview = song('deezer-preview');
    deezerPreview.provider = 'Deezer Preview';
    const fullTrack = song('full');
    const liveStation = { ...song('live'), provider: 'SomaFM' as const, isLive: true };

    expect(filterSongsByAccess([applePreview, deezerPreview, fullTrack, liveStation], 'preview')).toEqual([
      applePreview,
      deezerPreview,
    ]);
    expect(filterSongsByAccess([applePreview, deezerPreview, fullTrack, liveStation], 'full')).toEqual([fullTrack]);
    expect(isDirectFullTrack(liveStation)).toBe(false);
    expect(filterSongsByAccess([applePreview, deezerPreview, fullTrack, liveStation], 'all')).toEqual([
      applePreview,
      deezerPreview,
      fullTrack,
      liveStation,
    ]);
    expect(
      filterEntitiesByAccess(
        [{ id: 'itunes-album-1' }, { id: 'deezer-artist-2' }, { id: 'wikimedia-album-3' }],
        'full',
      ),
    ).toEqual([{ id: 'wikimedia-album-3' }]);
  });

  it('does not count a suspiciously short Kuwo clip as a full track', () => {
    const shortKuwo = { ...song('kuwo-short'), provider: 'Kuwo' as const, duration: 30 };

    expect(isFullTrack(shortKuwo)).toBe(false);
    expect(filterSongsByAccess([shortKuwo], 'full')).toEqual([]);
    expect(filterSongsByAccess([shortKuwo], 'preview')).toEqual([]);
  });

  it('removes obvious short clips while keeping named short-form music', () => {
    const ringtone = {
      ...song('audius-ringtone'),
      title: 'Yoru ni Kakeru (iPhone ringtone version)',
      provider: 'Audius' as const,
      duration: 35,
    };
    const shortSong = {
      ...song('audius-short-song'),
      title: 'Short song',
      provider: 'Audius' as const,
      duration: 30,
    };
    const interlude = {
      ...song('audius-interlude'),
      title: 'Interlude: Dawn',
      provider: 'Audius' as const,
      duration: 30,
    };

    expect(isCuratableTitle(ringtone)).toBe(false);
    expect(isSearchableSong(ringtone)).toBe(false);
    expect(isFullTrack(shortSong)).toBe(false);
    expect(filterSongsByAccess([ringtone, shortSong, interlude], 'full')).toEqual([interlude]);
    expect(filterSongsByAccess([ringtone, shortSong, interlude], 'all')).toEqual([interlude]);
  });

  it('includes full-length resolver matches in explicit access filters', () => {
    const resolverMatch = { ...song('kuwo-match'), provider: 'Kuwo' as const, duration: 241 };

    expect(isFullTrack(resolverMatch)).toBe(true);
    // Resolver sources with a full-track duration (>= 45s) are now included
    // in the 'Full tracks' filter so users searching for mainstream artists
    // actually see the real, playable tracks from Kuwo/LX, not just CC covers.
    expect(isDirectFullTrack(resolverMatch)).toBe(true);
    expect(filterSongsByAccess([resolverMatch], 'full')).toEqual([resolverMatch]);
    expect(filterSongsByAccess([resolverMatch], 'preview')).toEqual([]);
    expect(filterSongsByAccess([resolverMatch], 'all')).toEqual([resolverMatch]);
  });

  it('does not count an unknown-duration resolver record as a full track', () => {
    const unknownKuwo = { ...song('kuwo-unknown'), provider: 'Kuwo' as const, duration: 0 };
    const unknownLx = { ...song('lxmusic-unknown'), provider: 'LX Music' as const, duration: 0 };

    expect(isFullTrack(unknownKuwo)).toBe(false);
    expect(isFullTrack(unknownLx)).toBe(false);
    expect(filterSongsByAccess([unknownKuwo, unknownLx], 'full')).toEqual([]);
  });

  it('builds a station with the selected track first and full-track provider diversity', () => {
    const seed = {
      ...song('seed'),
      title: 'Seed Song',
      provider: 'Apple Preview' as const,
    };
    const duplicate = {
      ...song('duplicate'),
      title: 'Next One',
      artist: 'Audius Artist',
      provider: 'Jamendo' as const,
    };
    const candidates = [
      { ...song('audius-next'), title: 'Next One', artist: 'Audius Artist', provider: 'Audius' as const },
      duplicate,
      { ...song('wikimedia-next'), title: 'Another One', provider: 'Wikimedia Commons' as const },
      { ...song('short-kuwo'), title: 'Short Clip', provider: 'Kuwo' as const, duration: 30 },
      { ...song('live'), title: 'Live Station', provider: 'SomaFM' as const, isLive: true },
      { ...song('unavailable'), title: 'Unavailable', playbackUnavailable: true },
    ];

    expect(buildStationQueue(seed, candidates, 5).map(({ id }) => id)).toEqual([
      'seed',
      'audius-next',
      'wikimedia-next',
    ]);
  });

  it('applies a shelf limit after access filtering', () => {
    const previews = Array.from({ length: 6 }, (_, index) => providerSong(`itunes-${index}`, 'Apple Preview'));
    const fullTracks = [song('full-1'), song('full-2'), song('full-3')];

    expect(selectSongsByAccess([...previews, ...fullTracks], 'full', 2)).toEqual(fullTracks.slice(0, 2));
  });

  it('builds a varied next mix from favorites and listening history', () => {
    const heard = { ...song('heard'), artist: 'Seed Artist', genre: 'jazz', provider: 'Audius' as const };
    const favorite = { ...song('favorite'), artist: 'Favorite Artist', genre: 'ambient', provider: 'SomaFM' as const };
    const candidates = [
      heard,
      { ...song('same-artist'), artist: 'Favorite Artist', genre: 'classical', provider: 'Wikimedia Commons' as const },
      { ...song('same-genre'), artist: 'New Artist', genre: 'jazz', provider: 'Archive' as const },
      { ...song('same-provider'), artist: 'Another Artist', genre: 'pop', provider: 'Audius' as const },
      { ...song('unrelated'), artist: 'Elsewhere', genre: 'rock', provider: 'Jamendo' as const },
    ];

    const mix = buildListeningMix([heard], [favorite], candidates, 4);

    expect(mix.map(({ id }) => id)).toEqual(['same-artist', 'same-genre', 'same-provider', 'unrelated']);
    expect(mix.map(({ id }) => id)).not.toContain('heard');
  });

  it('filters access before limiting a personalized mix', () => {
    const seed = song('favorite');
    const previews = Array.from({ length: 12 }, (_, index) => providerSong(`itunes-${index}`, 'Apple Preview'));
    const fullTracks = [song('full-1'), song('full-2')];

    expect(buildListeningMixForAccess([], [seed], [...previews, ...fullTracks], 'full', 12)).toEqual(fullTracks);
  });

  it('gives a new listener a full-track-first mix without including live stations', () => {
    const preview = providerSong('itunes-1', 'Apple Preview');
    const fullOne = providerSong('full-1', 'Jamendo');
    const fullTwo = providerSong('full-2', 'Audius');
    const live = { ...providerSong('live-1', 'SomaFM'), isLive: true };

    expect(buildDiscoveryMixForAccess([], [], [preview, fullOne, live, fullTwo], 'all', 4).map(({ id }) => id)).toEqual(
      ['full-1', 'full-2', 'itunes-1'],
    );
  });
});
