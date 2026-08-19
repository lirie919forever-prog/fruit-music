import type { MusicProvider } from './types';
import type { MusicProviderName } from '@/types/music';
import { jamendoProvider } from './jamendoProvider';
import { ccmixterProvider } from './ccmixterProvider';
import { archiveProvider } from './archiveProvider';
import { lxmusicProvider } from './lxmusicProvider';
import { kuwoProvider, searchKuwo } from './kuwoProvider';
import { qqMusicProvider } from './qqMusicProvider';
import { bilibiliProvider } from './bilibiliProvider';
import { invidiousProvider } from './invidiousProvider';
import { neteaseProvider } from './neteaseProvider';
import { kugouProvider } from './kugouProvider';
import { itunesProvider } from './itunesProvider';
import { deezerProvider } from './deezerProvider';
import { audiusProvider } from './audiusProvider';
import { openverseProvider } from './openverseProvider';
import { wikimediaProvider } from './wikimediaProvider';
import { somaFmProvider } from './somaFmProvider';
import { ntsProvider } from './ntsProvider';
import { radioParadiseProvider } from './radioParadiseProvider';
import { kexpProvider } from './kexpProvider';
import { fipProvider } from './fipProvider';
import { theCurrentProvider } from './theCurrentProvider';
import { radioFranceProvider } from './radioFranceProvider';
import { asiaDreamRadioProvider } from './asiaDreamRadioProvider';
import { radioBrowserProvider } from './radioBrowserProvider';
import { localProvider } from './localProvider';

export interface ProviderRegistration {
  readonly name: MusicProviderName;
  readonly adapter: MusicProvider;
  readonly songPrefixes: readonly string[];
  readonly albumPrefixes: readonly string[];
  readonly artistPrefixes: readonly string[];
}

/**
 * The adapter registry is the only place that knows how normalized entity IDs
 * map back to a provider. Playback receives a Song and therefore routes by its
 * typed provider name; prefix matching remains only for old deep links that
 * contain an ID but no normalized entity metadata.
 */
export const MUSIC_PROVIDER_ADAPTERS: readonly ProviderRegistration[] = [
  {
    name: 'Jamendo',
    adapter: jamendoProvider,
    songPrefixes: ['jamendo-'],
    albumPrefixes: ['jamendo-'],
    artistPrefixes: ['jamendo-artist-'],
  },
  {
    name: 'ccMixter',
    adapter: ccmixterProvider,
    songPrefixes: ['ccmixter-'],
    albumPrefixes: ['ccmixter-album-'],
    artistPrefixes: ['ccmixter-artist-'],
  },
  {
    name: 'Archive',
    adapter: archiveProvider,
    songPrefixes: ['archive-'],
    albumPrefixes: ['archive-album-'],
    artistPrefixes: ['archive-artist-'],
  },
  {
    name: 'LX Music',
    adapter: lxmusicProvider,
    songPrefixes: ['lxmusic-'],
    albumPrefixes: ['lxmusic-album-'],
    artistPrefixes: ['lxmusic-artist-'],
  },
  {
    name: 'Kuwo',
    adapter: kuwoProvider,
    songPrefixes: ['kuwo-'],
    albumPrefixes: ['kuwo-album-'],
    artistPrefixes: ['kuwo-artist-'],
  },
  {
    name: 'QQ Music',
    adapter: qqMusicProvider,
    songPrefixes: ['qq-'],
    albumPrefixes: ['qq-album-'],
    artistPrefixes: ['qq-artist-'],
  },
  {
    name: 'Bilibili',
    adapter: bilibiliProvider,
    songPrefixes: ['bilibili-'],
    albumPrefixes: ['bilibili-album-'],
    artistPrefixes: ['bilibili-artist-'],
  },
  {
    name: 'Invidious',
    adapter: invidiousProvider,
    songPrefixes: ['invidious-'],
    albumPrefixes: ['invidious-album-'],
    artistPrefixes: ['invidious-artist-'],
  },
  {
    name: 'Netease',
    adapter: neteaseProvider,
    songPrefixes: ['netease-'],
    albumPrefixes: ['netease-album-'],
    artistPrefixes: ['netease-artist-'],
  },
  {
    name: 'Kugou',
    adapter: kugouProvider,
    songPrefixes: ['kugou-'],
    albumPrefixes: ['kugou-album-'],
    artistPrefixes: ['kugou-artist-'],
  },
  {
    name: 'Apple Preview',
    adapter: itunesProvider,
    songPrefixes: ['itunes-'],
    albumPrefixes: ['itunes-album-'],
    artistPrefixes: ['itunes-artist-'],
  },
  {
    name: 'Deezer Preview',
    adapter: deezerProvider,
    songPrefixes: ['deezer-'],
    albumPrefixes: ['deezer-album-'],
    artistPrefixes: ['deezer-artist-'],
  },
  {
    name: 'Audius',
    adapter: audiusProvider,
    songPrefixes: ['audius-'],
    albumPrefixes: ['audius-album-'],
    artistPrefixes: ['audius-artist-'],
  },
  {
    name: 'Openverse',
    adapter: openverseProvider,
    songPrefixes: ['openverse-'],
    albumPrefixes: ['openverse-album-'],
    artistPrefixes: ['openverse-artist-'],
  },
  {
    name: 'Wikimedia Commons',
    adapter: wikimediaProvider,
    songPrefixes: ['wikimedia-'],
    albumPrefixes: ['wikimedia-album-'],
    artistPrefixes: ['wikimedia-artist-'],
  },
  {
    name: 'SomaFM',
    adapter: somaFmProvider,
    songPrefixes: ['somafm-'],
    albumPrefixes: ['somafm-album-'],
    artistPrefixes: ['somafm-artist-'],
  },
  {
    name: 'NTS Radio',
    adapter: ntsProvider,
    songPrefixes: ['nts-'],
    albumPrefixes: ['nts-album-'],
    artistPrefixes: ['nts-artist-'],
  },
  {
    name: 'Radio Paradise',
    adapter: radioParadiseProvider,
    songPrefixes: ['radioparadise-'],
    albumPrefixes: ['radioparadise-album-'],
    artistPrefixes: ['radioparadise-artist-'],
  },
  {
    name: 'KEXP',
    adapter: kexpProvider,
    songPrefixes: ['kexp-'],
    albumPrefixes: ['kexp-album-'],
    artistPrefixes: ['kexp-artist-'],
  },
  {
    name: 'FIP',
    adapter: fipProvider,
    songPrefixes: ['fip-'],
    albumPrefixes: ['fip-album-'],
    artistPrefixes: ['fip-artist-'],
  },
  {
    name: 'The Current',
    adapter: theCurrentProvider,
    songPrefixes: ['thecurrent-'],
    albumPrefixes: ['thecurrent-album-'],
    artistPrefixes: ['thecurrent-artist-'],
  },
  {
    name: 'Radio France',
    adapter: radioFranceProvider,
    songPrefixes: ['radiofrance-'],
    albumPrefixes: ['radiofrance-album-'],
    artistPrefixes: ['radiofrance-artist-'],
  },
  {
    name: 'Asia Dream Radio',
    adapter: asiaDreamRadioProvider,
    songPrefixes: ['asiadream-'],
    albumPrefixes: ['asiadream-album-'],
    artistPrefixes: ['asiadream-artist-'],
  },
  {
    name: 'Radio Browser',
    adapter: radioBrowserProvider,
    songPrefixes: ['radio-'],
    albumPrefixes: ['radio-album-'],
    artistPrefixes: ['radio-artist-'],
  },
  { name: 'Local file', adapter: localProvider, songPrefixes: ['local-'], albumPrefixes: [], artistPrefixes: [] },
] as const;

const adapterByName = new Map(MUSIC_PROVIDER_ADAPTERS.map((registration) => [registration.name, registration.adapter]));

function adapterForId(id: string, key: 'songPrefixes' | 'albumPrefixes' | 'artistPrefixes'): MusicProvider {
  return (
    MUSIC_PROVIDER_ADAPTERS.find((registration) => registration[key].some((prefix) => id.startsWith(prefix)))
      ?.adapter ?? jamendoProvider
  );
}

export function getMusicProviderForName(name: MusicProviderName): MusicProvider {
  return adapterByName.get(name) ?? jamendoProvider;
}

export function getMusicProviderForSongId(songId: string): MusicProvider {
  return adapterForId(songId, 'songPrefixes');
}

export function getMusicProviderForAlbumId(albumId: string): MusicProvider {
  return adapterForId(albumId, 'albumPrefixes');
}

export function getMusicProviderForArtistId(artistId: string): MusicProvider {
  return adapterForId(artistId, 'artistPrefixes');
}

export {
  jamendoProvider,
  ccmixterProvider,
  archiveProvider,
  lxmusicProvider,
  kuwoProvider,
  searchKuwo,
  qqMusicProvider,
  bilibiliProvider,
  invidiousProvider,
  neteaseProvider,
  kugouProvider,
  itunesProvider,
  deezerProvider,
  audiusProvider,
  openverseProvider,
  wikimediaProvider,
  somaFmProvider,
  ntsProvider,
  radioParadiseProvider,
  kexpProvider,
  fipProvider,
  theCurrentProvider,
  radioFranceProvider,
  asiaDreamRadioProvider,
  radioBrowserProvider,
  localProvider,
};
export type { MusicProvider };
