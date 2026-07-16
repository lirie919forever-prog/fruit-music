export interface Album {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  coverArt: string;
  songCount: number;
  duration: number;
  year: number;
  genre: string;
}

export interface Artist {
  id: string;
  name: string;
  coverArt: string;
  albumCount: number;
}

export type MusicProviderName = 'Jamendo' | 'ccMixter' | 'Archive';

export interface Song {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  album: string;
  albumId: string;
  coverArt: string;
  duration: number;
  track: number;
  year: number;
  genre: string;
  path: string;
  bitRate: number;
  contentType: string;
  suffix: string;
  size: number;
  provider: MusicProviderName;
  sourceUrl: string;
  creatorUrl: string;
  licenseName: string;
  licenseUrl: string;
  attributionUrl: string;
  metadataVerified: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  songCount: number;
  duration: number;
  coverArt: string;
}

export interface QueueItem {
  song: Song;
  addedBy: 'user' | 'autoplay';
}

export type ViewType = 'albums' | 'artists' | 'search' | 'playlist' | 'now-playing' | 'pop' | 'jp' | 'trending' | 'remixes' | 'jazz' | 'classical';
