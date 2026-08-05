import { describe, expect, it } from 'vitest';
import { isSong } from './songShape';

function baseSong() {
  return {
    id: 'jamendo-song',
    title: 'Song',
    artist: 'Artist',
    artistId: 'artist',
    album: 'Album',
    albumId: 'album',
    coverArt: '/placeholder-album.svg',
    duration: 120,
    path: '/song.mp3',
    provider: 'Jamendo',
    licenseName: 'CC BY',
  };
}

describe('song shape validation', () => {
  it('accepts runtime provider names', () => {
    expect(isSong(baseSong())).toBe(true);
  });

  it('rejects unknown provider names before persistence or rendering', () => {
    expect(isSong({ ...baseSong(), provider: 'Unknown source' })).toBe(false);
  });
});
