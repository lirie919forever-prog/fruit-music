import type { MusicProvider } from './types';
import { jamendoProvider } from './jamendoProvider';
import { ccmixterProvider } from './ccmixterProvider';
import { archiveProvider } from './archiveProvider';
import { lxmusicProvider } from './lxmusicProvider';
import { kuwoProvider } from './kuwoProvider';
import { itunesProvider } from './itunesProvider';
import { deezerProvider } from './deezerProvider';
import { audiusProvider } from './audiusProvider';
import { openverseProvider } from './openverseProvider';
import { wikimediaProvider } from './wikimediaProvider';
import { somaFmProvider } from './somaFmProvider';
import { radioBrowserProvider } from './radioBrowserProvider';

let cachedProvider: MusicProvider | null = null;

export function getMusicProvider(): MusicProvider {
  if (!cachedProvider) {
    cachedProvider = jamendoProvider;
  }
  return cachedProvider;
}

export function getMusicProviderForSongId(songId: string): MusicProvider {
  if (songId.startsWith('ccmixter-')) return ccmixterProvider;
  if (songId.startsWith('archive-')) return archiveProvider;
  if (songId.startsWith('lxmusic-')) return lxmusicProvider;
  if (songId.startsWith('kuwo-')) return kuwoProvider;
  if (songId.startsWith('itunes-')) return itunesProvider;
  if (songId.startsWith('deezer-')) return deezerProvider;
  if (songId.startsWith('audius-')) return audiusProvider;
  if (songId.startsWith('openverse-')) return openverseProvider;
  if (songId.startsWith('wikimedia-')) return wikimediaProvider;
  if (songId.startsWith('somafm-')) return somaFmProvider;
  if (songId.startsWith('radio-')) return radioBrowserProvider;
  return jamendoProvider;
}

export function getMusicProviderForAlbumId(albumId: string): MusicProvider {
  if (albumId.startsWith('ccmixter-album-')) return ccmixterProvider;
  if (albumId.startsWith('archive-album-')) return archiveProvider;
  if (albumId.startsWith('lxmusic-album-')) return lxmusicProvider;
  if (albumId.startsWith('kuwo-album-')) return kuwoProvider;
  if (albumId.startsWith('itunes-album-')) return itunesProvider;
  if (albumId.startsWith('deezer-album-')) return deezerProvider;
  if (albumId.startsWith('audius-album-')) return audiusProvider;
  if (albumId.startsWith('openverse-album-')) return openverseProvider;
  if (albumId.startsWith('wikimedia-album-')) return wikimediaProvider;
  if (albumId.startsWith('somafm-album-')) return somaFmProvider;
  if (albumId.startsWith('radio-album-')) return radioBrowserProvider;
  return jamendoProvider;
}

export function getMusicProviderForArtistId(artistId: string): MusicProvider {
  if (artistId.startsWith('ccmixter-artist-')) return ccmixterProvider;
  if (artistId.startsWith('archive-artist-')) return archiveProvider;
  if (artistId.startsWith('lxmusic-artist-')) return lxmusicProvider;
  if (artistId.startsWith('kuwo-artist-')) return kuwoProvider;
  if (artistId.startsWith('itunes-artist-')) return itunesProvider;
  if (artistId.startsWith('deezer-artist-')) return deezerProvider;
  if (artistId.startsWith('audius-artist-')) return audiusProvider;
  if (artistId.startsWith('openverse-artist-')) return openverseProvider;
  if (artistId.startsWith('wikimedia-artist-')) return wikimediaProvider;
  if (artistId.startsWith('somafm-artist-')) return somaFmProvider;
  if (artistId.startsWith('radio-artist-')) return radioBrowserProvider;
  return jamendoProvider;
}

export {
  jamendoProvider,
  ccmixterProvider,
  archiveProvider,
  lxmusicProvider,
  kuwoProvider,
  itunesProvider,
  deezerProvider,
  audiusProvider,
  openverseProvider,
  wikimediaProvider,
  somaFmProvider,
  radioBrowserProvider,
};
export type { MusicProvider };
