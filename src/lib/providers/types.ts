import type { Album, Artist, Song } from '@/types/music';

export interface MusicProvider {
  getAlbums(signal?: AbortSignal): Promise<Album[]>;
  getArtists(signal?: AbortSignal): Promise<Artist[]>;
  getAlbumSongs(albumId: string, signal?: AbortSignal): Promise<Song[]>;
  getArtistSongs(artistId: string, signal?: AbortSignal): Promise<Song[]>;
  search(query: string, signal?: AbortSignal): Promise<Song[]>;
  getStreamUrl(song: Song, signal?: AbortSignal): Promise<string>;
  getSongsByTag(tag: string, limit?: number, signal?: AbortSignal): Promise<Song[]>;
  getTrending(limit?: number, signal?: AbortSignal): Promise<Song[]>;
}
