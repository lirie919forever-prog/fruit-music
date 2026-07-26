import { describe, expect, it } from 'vitest';
import type { Song } from '@/types/music';
import { interleaveSongGroups, playableSongs, uniqueAlbumSongs } from './newViewModel';

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

  it('separates playable tracks and deduplicates album representatives', () => {
    const unknownAlbum = song('unknown', 'album-unknown');
    unknownAlbum.album = 'Unknown';
    const songs = [song('a1', 'album-a'), song('a2', 'album-a'), song('b1', 'album-b', true), unknownAlbum];
    expect(playableSongs(songs).map(({ id }) => id)).toEqual(['a1', 'a2', 'unknown']);
    expect(uniqueAlbumSongs(songs).map(({ id }) => id)).toEqual(['a1', 'b1']);
  });
});
