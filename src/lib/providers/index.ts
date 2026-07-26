import type { MusicProvider } from './types';
import { jamendoProvider } from './jamendoProvider';
import { ccmixterProvider } from './ccmixterProvider';
import { archiveProvider } from './archiveProvider';
import { lxmusicProvider } from './lxmusicProvider';
import { itunesProvider } from './itunesProvider';

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
  if (songId.startsWith('itunes-')) return itunesProvider;
  return jamendoProvider;
}

export function getMusicProviderForAlbumId(albumId: string): MusicProvider {
  if (albumId.startsWith('ccmixter-album-')) return ccmixterProvider;
  if (albumId.startsWith('archive-album-')) return archiveProvider;
  if (albumId.startsWith('lxmusic-album-')) return lxmusicProvider;
  if (albumId.startsWith('itunes-album-')) return itunesProvider;
  return jamendoProvider;
}

export function getMusicProviderForArtistId(artistId: string): MusicProvider {
  if (artistId.startsWith('ccmixter-artist-')) return ccmixterProvider;
  if (artistId.startsWith('archive-artist-')) return archiveProvider;
  if (artistId.startsWith('lxmusic-artist-')) return lxmusicProvider;
  if (artistId.startsWith('itunes-artist-')) return itunesProvider;
  return jamendoProvider;
}

export { jamendoProvider, ccmixterProvider, archiveProvider, lxmusicProvider, itunesProvider };
export type { MusicProvider };
