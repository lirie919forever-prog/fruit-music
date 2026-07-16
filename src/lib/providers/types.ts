import type { Album, Artist, Song } from '@/types/music';

export interface MusicProvider {
  getAlbums(): Promise<Album[]>;
  getArtists(): Promise<Artist[]>;
  getAlbumSongs(albumId: string): Promise<Song[]>;
  getArtistSongs(artistId: string): Promise<Song[]>;
  search(query: string): Promise<Song[]>;
  getStreamUrl(song: Song): Promise<string>;
  getSongsByTag(tag: string, limit?: number): Promise<Song[]>;
  getTrending(limit?: number): Promise<Song[]>;
}
