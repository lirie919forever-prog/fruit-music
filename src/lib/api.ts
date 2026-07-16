import type { Album, Artist, Song } from '@/types/music';
import {
  archiveProvider,
  ccmixterProvider,
  getMusicProviderForAlbumId,
  getMusicProviderForArtistId,
  getMusicProviderForSongId,
  jamendoProvider,
} from '@/lib/providers';

function dedupeEntities<T extends { id: string }>(entities: T[]): T[] {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    if (seen.has(entity.id)) return false;
    seen.add(entity.id);
    return true;
  });
}

async function collectSuccessful<T>(requests: Array<Promise<T[]>>): Promise<T[]> {
  const settled = await Promise.allSettled(requests);
  return settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
}

function dedupeSongs(songs: Song[]): Song[] {
  return dedupeEntities(songs);
}

export interface FederatedSearchResult {
  results: Song[];
  failedProviders: string[];
  providerCount: number;
}

export async function searchFederated(query: string): Promise<FederatedSearchResult> {
  const providers = [
    { name: 'Jamendo', search: () => jamendoProvider.search(query) },
    { name: 'ccMixter', search: () => ccmixterProvider.search(query) },
    { name: 'Archive', search: () => archiveProvider.search(query) },
  ];
  const settled = await Promise.allSettled(providers.map((provider) => provider.search()));
  const failedProviders = settled.flatMap((result, index) =>
    result.status === 'rejected' ? [providers[index].name] : []
  );
  const songs = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);

  return {
    results: dedupeSongs(songs),
    failedProviders,
    providerCount: providers.length,
  };
}

export function isServerConfigured(): boolean {
  return true;
}

export const api = {
  async getAlbums(): Promise<Album[]> {
    return jamendoProvider.getAlbums();
  },

  async getArtists(): Promise<Artist[]> {
    return dedupeEntities(await collectSuccessful([
      jamendoProvider.getArtists(),
      ccmixterProvider.getArtists(),
    ]));
  },

  async getAlbumSongs(albumId: string): Promise<Song[]> {
    return getMusicProviderForAlbumId(albumId).getAlbumSongs(albumId);
  },

  async getArtistSongs(artistId: string): Promise<Song[]> {
    return getMusicProviderForArtistId(artistId).getArtistSongs(artistId);
  },

  search: searchFederated,

  async getSongsByTag(tag: string, limit?: number): Promise<Song[]> {
    return jamendoProvider.getSongsByTag(tag, limit);
  },

  async getTrending(limit = 50): Promise<Song[]> {
    const results = await Promise.allSettled([
      jamendoProvider.getTrending(limit),
      ccmixterProvider.getTrending(limit),
    ]);
    return dedupeSongs(results.flatMap((result) => result.status === 'fulfilled' ? result.value : []));
  },

  async getStreamUrl(song: Song): Promise<string> {
    return getMusicProviderForSongId(song.id).getStreamUrl(song);
  },

  normalizeCoverArt(id: string): string {
    if (!id) return '/placeholder-album.svg';
    if (id.startsWith('http') || id.startsWith('data:') || id.startsWith('/')) return id;
    return '/placeholder-album.svg';
  },

  isServerConfigured,
};

