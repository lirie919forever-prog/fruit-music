import type { MusicProvider } from './types';
import { loadLocalSong } from '@/lib/localMusic';

/**
 * Browser imports resolve to object URLs and desktop imports to opaque
 * `marea-media://` URLs. Keeping both behind the same adapter contract gives
 * the audio engine one resolution path without exposing filesystem paths.
 */
export const localProvider: MusicProvider = {
  getAlbums: async () => [],
  getArtists: async () => [],
  getAlbumSongs: async () => [],
  getArtistSongs: async () => [],
  search: async () => [],
  getStreamUrl: async (song) => (await loadLocalSong(song.id))?.path ?? song.path,
  getSongsByTag: async () => [],
  getTrending: async () => [],
};
