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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}

function dedupeSongs(songs: Song[]): Song[] {
  return dedupeEntities(songs);
}

export interface FederatedResult<T> {
  results: T[];
  failedProviders: string[];
  providerCount: number;
}

export type FederatedSearchResult = FederatedResult<Song>;

export async function searchFederated(query: string, signal?: AbortSignal): Promise<FederatedSearchResult> {
  const providers = [
    { name: 'Jamendo', search: () => jamendoProvider.search(query, signal) },
    { name: 'ccMixter', search: () => ccmixterProvider.search(query, signal) },
    { name: 'Archive', search: () => archiveProvider.search(query, signal) },
  ];
  const settled = await Promise.allSettled(providers.map((provider) => provider.search()));
  throwIfAborted(signal);
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
  async getAlbums(signal?: AbortSignal): Promise<FederatedResult<Album>> {
    const providers = [
      { name: 'Jamendo', get: () => jamendoProvider.getAlbums(signal) },
      { name: 'ccMixter', get: () => ccmixterProvider.getAlbums(signal) },
    ];
    const settled = await Promise.allSettled(providers.map((provider) => provider.get()));
    throwIfAborted(signal);
    return { results: dedupeEntities(settled.flatMap((result) => result.status === 'fulfilled' ? result.value : [])), failedProviders: settled.flatMap((result, index) => result.status === 'rejected' ? [providers[index].name] : []), providerCount: providers.length };
  },

  async getArtists(signal?: AbortSignal): Promise<FederatedResult<Artist>> {
    const providers = [
      { name: 'Jamendo', get: () => jamendoProvider.getArtists(signal) },
      { name: 'ccMixter', get: () => ccmixterProvider.getArtists(signal) },
    ];
    const settled = await Promise.allSettled(providers.map((provider) => provider.get()));
    throwIfAborted(signal);
    return { results: dedupeEntities(settled.flatMap((result) => result.status === 'fulfilled' ? result.value : [])), failedProviders: settled.flatMap((result, index) => result.status === 'rejected' ? [providers[index].name] : []), providerCount: providers.length };
  },

  async getAlbumSongs(albumId: string, signal?: AbortSignal): Promise<Song[]> {
    return getMusicProviderForAlbumId(albumId).getAlbumSongs(albumId, signal);
  },

  async getArtistSongs(artistId: string, signal?: AbortSignal): Promise<Song[]> {
    return getMusicProviderForArtistId(artistId).getArtistSongs(artistId, signal);
  },

  search: searchFederated,

  async getSongsByTag(tag: string, limit?: number, signal?: AbortSignal): Promise<Song[]> {
    return jamendoProvider.getSongsByTag(tag, limit, signal);
  },

  async getTrending(limit = 50, signal?: AbortSignal): Promise<FederatedResult<Song>> {
    const providers = [
      { name: 'Jamendo', get: () => jamendoProvider.getTrending(limit, signal) },
      { name: 'ccMixter', get: () => ccmixterProvider.getTrending(limit, signal) },
    ];
    const settled = await Promise.allSettled(providers.map((provider) => provider.get()));
    throwIfAborted(signal);
    return { results: dedupeSongs(settled.flatMap((result) => result.status === 'fulfilled' ? result.value : [])), failedProviders: settled.flatMap((result, index) => result.status === 'rejected' ? [providers[index].name] : []), providerCount: providers.length };
  },

  async getStreamUrl(song: Song, signal?: AbortSignal): Promise<string> {
    return getMusicProviderForSongId(song.id).getStreamUrl(song, signal);
  },

  normalizeCoverArt(id: string): string {
    if (!id) return '/placeholder-album.svg';
    if (id.startsWith('http') || id.startsWith('data:') || id.startsWith('/')) return id;
    return '/placeholder-album.svg';
  },

  isServerConfigured,
};

