import { describe, expect, it } from 'vitest';
import { mediaArtwork, mediaMetadataInit, positionState } from './mediaSession';
import type { Song } from '@/types/music';

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: 'a',
    title: 'Title',
    artist: 'Artist',
    artistId: 'artist-1',
    album: 'Album',
    albumId: 'album-1',
    coverArt: 'https://is1-ssl.mzstatic.com/image/thumb/a/600x600bb.jpg',
    duration: 100,
    track: 1,
    year: 2026,
    genre: 'Test',
    path: '/stream/a',
    bitRate: 0,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: 1,
    provider: 'Jamendo',
    sourceUrl: '',
    creatorUrl: '',
    licenseName: 'CC BY',
    licenseUrl: '',
    attributionUrl: '',
    metadataVerified: true,
    ...overrides,
  };
}

describe('mediaArtwork', () => {
  it('declares an unknown-size cover as any rather than inventing a number', () => {
    // The wiring this replaced said `512x512` for every cover in the app. None
    // of them was 512 square, and a platform choosing between candidates was
    // being handed a measurement nobody had taken.
    expect(mediaArtwork('https://is1-ssl.mzstatic.com/image/thumb/a/600x600bb.jpg')).toEqual([
      { src: 'https://is1-ssl.mzstatic.com/image/thumb/a/600x600bb.jpg', sizes: 'any' },
    ]);
  });

  it('names the type for an SVG, which is the fallback cover', () => {
    expect(mediaArtwork('/placeholder-album.svg')).toEqual([
      { src: '/placeholder-album.svg', sizes: 'any', type: 'image/svg+xml' },
    ]);
  });

  it('names the type for an inline SVG cover too', () => {
    expect(mediaArtwork('data:image/svg+xml;charset=utf-8,%3Csvg')[0].type).toBe('image/svg+xml');
  });

  it('declares nothing when there is no cover', () => {
    expect(mediaArtwork('')).toEqual([]);
  });
});

describe('mediaMetadataInit', () => {
  it('carries title, artist and album through', () => {
    expect(mediaMetadataInit(song())).toMatchObject({ title: 'Title', artist: 'Artist', album: 'Album' });
  });

  it('drops an album that only repeats the track title', () => {
    // Singles come back this way constantly, and the OS popup has two lines.
    expect(mediaMetadataInit(song({ title: 'Creep', album: 'Creep' })).album).toBe('');
  });
});

describe('positionState', () => {
  it('reports a normal position unchanged', () => {
    expect(positionState(200, 45)).toEqual({ duration: 200, position: 45, playbackRate: 1 });
  });

  it('refuses a duration that is zero, negative or not a number', () => {
    // `setPositionState` throws on each of these rather than ignoring them,
    // and it is called from inside the audio engine's effect.
    expect(positionState(0, 0)).toBeNull();
    expect(positionState(-5, 0)).toBeNull();
    expect(positionState(Number.NaN, 0)).toBeNull();
    expect(positionState(Number.POSITIVE_INFINITY, 0)).toBeNull();
  });

  it('refuses a non-positive or non-finite rate', () => {
    expect(positionState(200, 10, 0)).toBeNull();
    expect(positionState(200, 10, -1)).toBeNull();
    expect(positionState(200, 10, Number.NaN)).toBeNull();
  });

  it('refuses a position that is not a number', () => {
    expect(positionState(200, Number.NaN)).toBeNull();
  });

  it('clamps a position that has run just past the end', () => {
    // The last progress frame can land after the duration while the `ended`
    // event is still in flight. That is the one case worth clamping, because
    // the alternative is a thrown TypeError inside the engine.
    expect(positionState(200, 200.4)?.position).toBe(200);
    expect(positionState(200, -3)?.position).toBe(0);
  });
});
