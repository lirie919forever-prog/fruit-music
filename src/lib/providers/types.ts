import type { Album, Artist, Song } from '@/types/music';

export interface ProviderCatalogResult<T> {
  results: T[];
  degraded?: boolean;
}

export interface MusicProvider {
  getAlbums(signal?: AbortSignal): Promise<Album[]>;
  getAlbumsWithStatus?(signal?: AbortSignal): Promise<ProviderCatalogResult<Album>>;
  getAlbumById?(albumId: string, signal?: AbortSignal): Promise<Album | null>;
  getArtists(signal?: AbortSignal): Promise<Artist[]>;
  getArtistsWithStatus?(signal?: AbortSignal): Promise<ProviderCatalogResult<Artist>>;
  getArtistById?(artistId: string, signal?: AbortSignal): Promise<Artist | null>;
  getAlbumSongs(albumId: string, signal?: AbortSignal): Promise<Song[]>;
  getArtistSongs(artistId: string, signal?: AbortSignal): Promise<Song[]>;
  search(query: string, signal?: AbortSignal): Promise<Song[]>;
  searchWithStatus?(query: string, signal?: AbortSignal): Promise<ProviderCatalogResult<Song>>;
  /** Optional: providers with no album or artist index simply omit these. */
  searchAlbums?(query: string, signal?: AbortSignal): Promise<Album[]>;
  searchArtists?(query: string, signal?: AbortSignal): Promise<Artist[]>;
  /** Optional: an artist's releases, for the discography on their page. */
  getArtistAlbums?(artistId: string, signal?: AbortSignal): Promise<Album[]>;
  getSongById?(songId: string, signal?: AbortSignal): Promise<Song | null>;
  getStreamUrl(song: Song, signal?: AbortSignal): Promise<string>;
  getSongsByTag(tag: string, limit?: number, signal?: AbortSignal): Promise<Song[]>;
  getSongsByTagWithStatus?(tag: string, limit?: number, signal?: AbortSignal): Promise<ProviderCatalogResult<Song>>;
  getTrending(limit?: number, signal?: AbortSignal): Promise<Song[]>;
  getTrendingWithStatus?(limit?: number, signal?: AbortSignal): Promise<ProviderCatalogResult<Song>>;
  lastCatalogDegraded?: boolean;
}
