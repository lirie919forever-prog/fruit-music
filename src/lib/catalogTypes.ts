import type { LyricsResult } from '@/lib/lyrics/lrclib';
import type { Album, Artist, Song } from '@/types/music';

export const NO_VERIFIED_FULL_TRACK_MESSAGE = 'No verified full-length recording is available for this track.';

export interface PlaybackCandidate {
  song: Song;
  streamUrl?: string;
}

export interface PlaybackSource extends PlaybackCandidate {
  streamUrl: string;
  candidates?: PlaybackCandidate[];
}

export interface FederatedResult<T> {
  results: T[];
  failedProviders: string[];
  degradedProviders?: string[];
  providerCount: number;
}

export type FederatedSearchResult = FederatedResult<Song>;

/** The chart pages the server can build. Kept in sync with the charts route. */
export type ChartKey = 'billboard' | 'uk' | 'jp';

/** Controls optional full-track hydration for a chart response. */
export interface ChartFetchOptions {
  resolveFullTracks?: boolean;
  /**
   * Caps the number of ranked rows that are hydrated ahead of time. The home
   * shelf uses a small budget so it resolves quickly; dedicated chart pages
   * can afford the full chart.
   */
  rowLimit?: number;
  /**
   * Audius is excluded from background hydration by default because it rate-
   * limits aggressively (429). It remains available for user-initiated
   * playback fallback through the normal resolution path.
   */
  includeAudius?: boolean;
}

/**
 * The renderer-facing catalog port. Providers and transport details stay
 * behind this interface so views can be tested with a deterministic catalog
 * and the app can replace the backing service without changing UI code.
 */
export interface MusicCatalog {
  getAlbums(signal?: AbortSignal): Promise<FederatedResult<Album>>;
  getArtists(signal?: AbortSignal): Promise<FederatedResult<Artist>>;
  resolveAlbum(albumId: string, signal?: AbortSignal): Promise<Album | null>;
  resolveArtist(artistId: string, signal?: AbortSignal): Promise<Artist | null>;
  getAlbumSongs(albumId: string, signal?: AbortSignal): Promise<Song[]>;
  getArtistSongs(artistId: string, signal?: AbortSignal): Promise<Song[]>;
  getArtistAlbums(artistId: string, signal?: AbortSignal): Promise<Album[]>;
  search(query: string, signal?: AbortSignal, source?: string): Promise<FederatedSearchResult>;
  searchAlbums(query: string, signal?: AbortSignal, source?: string): Promise<FederatedResult<Album>>;
  searchArtists(query: string, signal?: AbortSignal, source?: string): Promise<FederatedResult<Artist>>;
  getSongsByTag(tag: string, limit?: number, signal?: AbortSignal): Promise<Song[]>;
  getCcmixterSongsByTag(tag: string, limit?: number, signal?: AbortSignal): Promise<FederatedResult<Song>>;
  getGenreSongs(tag: string, limit?: number, signal?: AbortSignal): Promise<FederatedResult<Song>>;
  getLiveStations(limit?: number, signal?: AbortSignal): Promise<FederatedResult<Song>>;
  getRecentReleases(limit?: number, signal?: AbortSignal): Promise<Song[]>;
  getTrending(limit?: number, signal?: AbortSignal): Promise<FederatedResult<Song>>;
  getChartSongs(chart: ChartKey, signal?: AbortSignal, options?: ChartFetchOptions): Promise<Song[]>;
  getLyrics(song: Song, signal?: AbortSignal): Promise<LyricsResult | null>;
  resolveSong(songId: string, signal?: AbortSignal): Promise<Song | null>;
  getStreamUrl(song: Song, signal?: AbortSignal): Promise<string>;
  getPlaybackAlternates(song: Song, signal?: AbortSignal): Promise<PlaybackCandidate[]>;
  getPlaybackSource(song: Song, signal?: AbortSignal): Promise<PlaybackSource>;
  isServerConfigured(): boolean;
}
