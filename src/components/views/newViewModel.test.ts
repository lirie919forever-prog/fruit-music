import { describe, expect, it } from 'vitest';
import type { Song } from '@/types/music';
import {
  buildListeningMix,
  buildListeningMixForAccess,
  filterEntitiesByAccess,
  filterSongsByAccess,
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

    expect(filterSongsByAccess([applePreview, deezerPreview, fullTrack], 'preview')).toEqual([
      applePreview,
      deezerPreview,
    ]);
    expect(filterSongsByAccess([applePreview, deezerPreview, fullTrack], 'full')).toEqual([fullTrack]);
    expect(filterSongsByAccess([applePreview, deezerPreview, fullTrack], 'all')).toEqual([
      applePreview,
      deezerPreview,
      fullTrack,
    ]);
    expect(
      filterEntitiesByAccess(
        [{ id: 'itunes-album-1' }, { id: 'deezer-artist-2' }, { id: 'wikimedia-album-3' }],
        'full',
      ),
    ).toEqual([{ id: 'wikimedia-album-3' }]);
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
});
