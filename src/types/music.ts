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

export type MusicProviderName =
  | 'Jamendo'
  | 'ccMixter'
  | 'Archive'
  | 'LX Music'
  | 'Kuwo'
  | 'QQ Music'
  | 'Bilibili'
  | 'Apple Preview'
  | 'Deezer Preview'
  | 'Audius'
  | 'Openverse'
  | 'Wikimedia Commons'
  | 'SomaFM'
  | 'NTS Radio'
  | 'Radio Paradise'
  | 'KEXP'
  | 'FIP'
  | 'The Current'
  | 'Radio France'
  | 'Radio Browser'
  | 'Invidious'
  | 'Netease'
  | 'Kugou'
  | 'Local file';

export interface Song {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  album: string;
  albumId: string;
  coverArt: string;
  duration: number;
  /**
   * The full recording length when a catalog only exposes a preview clip.
   * This is verification metadata, not the duration currently exposed by the
   * playable stream.
   */
  recordingDuration?: number;
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
  /** Continuous station streams have no finite duration or seek position. */
  isLive?: boolean;
  playbackUnavailable?: boolean;
}

/**
 * A user-built playlist. Held in full rather than as a summary of provider ids:
 * a playlist has to keep working when the provider stops serving a track, and
 * the count, duration and cover are all derivable from the songs themselves.
 */
export interface Playlist {
  id: string;
  name: string;
  songs: Song[];
  createdAt: number;
}

export interface QueueItem {
  song: Song;
  addedBy: 'user' | 'autoplay';
}

/** Which side panel the Now Playing view opens on. */
export type NowPlayingPanel = 'queue' | 'lyrics';

export type ViewType =
  | 'new'
  | 'albums'
  | 'artists'
  | 'search'
  | 'favorites'
  | 'history'
  | 'playlist'
  | 'now-playing'
  | 'pop'
  | 'jp'
  | 'billboard'
  | 'uk'
  | 'trending'
  | 'radio'
  | 'remixes'
  | 'jazz'
  | 'classical'
  | 'sources';
