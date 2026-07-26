import type { Album, Artist, Song } from '@/types/music';
import {
  archiveProvider,
  ccmixterProvider,
  getMusicProviderForAlbumId,
  getMusicProviderForArtistId,
  getMusicProviderForSongId,
  itunesProvider,
  jamendoProvider,
  lxmusicProvider,
} from '@/lib/providers';
import type { ProviderCatalogResult } from '@/lib/providers/types';
import { ProviderError, providerFetch } from '@/lib/providers/errors';

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

export interface FederatedResult<T> {
  results: T[];
  failedProviders: string[];
  degradedProviders?: string[];
  providerCount: number;
}

export type FederatedSearchResult = FederatedResult<Song>;

/** The chart pages the server can build. Kept in sync with `CHARTS` in the charts route. */
export type ChartKey = 'billboard' | 'uk' | 'jp' | 'pop';

type CatalogProvider<T> = {
  name: string;
  get: () => Promise<ProviderCatalogResult<T>>;
};

async function federateCatalog<T extends { id: string }>(
  providers: Array<CatalogProvider<T>>,
  signal?: AbortSignal,
): Promise<FederatedResult<T>> {
  const settled = await Promise.allSettled(providers.map((provider) => provider.get()));
  throwIfAborted(signal);
  const failedProviders = settled.flatMap((result, index) =>
    result.status === 'rejected' ? [providers[index].name] : []
  );
  const degradedProviders = settled.flatMap((result, index) =>
    result.status === 'fulfilled' && result.value.degraded ? [providers[index].name] : []
  );
  const results = dedupeEntities(settled.flatMap((result) =>
    result.status === 'fulfilled' ? result.value.results : []
  ));

  return {
    results,
    failedProviders,
    ...(degradedProviders.length > 0 ? { degradedProviders } : {}),
    providerCount: providers.length,
  };
}

export async function searchFederated(query: string, signal?: AbortSignal): Promise<FederatedSearchResult> {
  // Apple leads the list because it is the only source here that can answer a
  // search for a mainstream release. The Creative Commons providers still run —
  // they carry the full-length recordings Apple only previews — but a query for
  // a song everybody knows used to return nothing at all.
  const providers: Array<CatalogProvider<Song>> = [
    { name: 'Apple Preview', get: async () => ({ results: await itunesProvider.search(query, signal) }) },
    { name: 'Jamendo', get: async () => ({ results: await jamendoProvider.search(query, signal) }) },
    { name: 'ccMixter', get: () => ccmixterProvider.searchWithStatus(query, signal) },
    { name: 'Archive', get: async () => ({ results: await archiveProvider.search(query, signal) }) },
  ];
  const lxEnabled = process.env.NEXT_PUBLIC_LX_ENABLED === 'true';
  if (lxEnabled) {
    providers.push({ name: 'LX Music', get: async () => ({ results: await lxmusicProvider.search(query, signal) }) });
  }
  return federateCatalog(providers, signal);
}

/**
 * Album and artist search, federated across the providers that have an index
 * for them.
 *
 * Not every provider does: ccMixter and Archive have no album or artist search
 * at all, and calling their track search here would return matches that are not
 * albums. Those providers stay out of these two lists rather than being
 * approximated, so an empty artists section means nobody matched, not that
 * somebody was skipped.
 */
export async function searchAlbumsFederated(query: string, signal?: AbortSignal): Promise<FederatedResult<Album>> {
  return federateCatalog([
    { name: 'Apple Preview', get: async () => ({ results: await itunesProvider.searchAlbums(query, signal) }) },
    { name: 'Jamendo', get: async () => ({ results: await jamendoProvider.searchAlbums(query, signal) }) },
  ], signal);
}

export async function searchArtistsFederated(query: string, signal?: AbortSignal): Promise<FederatedResult<Artist>> {
  return federateCatalog([
    { name: 'Apple Preview', get: async () => ({ results: await itunesProvider.searchArtists(query, signal) }) },
    { name: 'Jamendo', get: async () => ({ results: await jamendoProvider.searchArtists(query, signal) }) },
  ], signal);
}

export function isServerConfigured(): boolean {
  return true;
}

export const api = {
  async getAlbums(signal?: AbortSignal): Promise<FederatedResult<Album>> {
    const providers: Array<CatalogProvider<Album>> = [
      { name: 'Apple Preview', get: async () => ({ results: await itunesProvider.getAlbums(signal) }) },
      { name: 'Jamendo', get: async () => ({ results: await jamendoProvider.getAlbums(signal) }) },
      { name: 'ccMixter', get: () => ccmixterProvider.getAlbumsWithStatus(signal) },
    ];
    return federateCatalog(providers, signal);
  },

  async getArtists(signal?: AbortSignal): Promise<FederatedResult<Artist>> {
    const providers: Array<CatalogProvider<Artist>> = [
      { name: 'Apple Preview', get: async () => ({ results: await itunesProvider.getArtists(signal) }) },
      { name: 'Jamendo', get: async () => ({ results: await jamendoProvider.getArtists(signal) }) },
      { name: 'ccMixter', get: () => ccmixterProvider.getArtistsWithStatus(signal) },
    ];
    return federateCatalog(providers, signal);
  },

  // A direct provider lookup comes first because the federated catalog only
  // returns one page per provider; a deep link to any record outside that page
  // would otherwise report an unavailable album/artist that in fact exists.
  async resolveAlbum(albumId: string, signal?: AbortSignal): Promise<Album | null> {
    if (!albumId) return null;
    const provider = getMusicProviderForAlbumId(albumId);
    if (provider.getAlbumById) {
      const album = await provider.getAlbumById(albumId, signal);
      if (album) return album;
      throwIfAborted(signal);
    }
    const result = await this.getAlbums(signal);
    return result.results.find((album) => album.id === albumId) ?? null;
  },

  async resolveArtist(artistId: string, signal?: AbortSignal): Promise<Artist | null> {
    if (!artistId) return null;
    const provider = getMusicProviderForArtistId(artistId);
    if (provider.getArtistById) {
      const artist = await provider.getArtistById(artistId, signal);
      if (artist) return artist;
      throwIfAborted(signal);
    }
    const result = await this.getArtists(signal);
    return result.results.find((artist) => artist.id === artistId) ?? null;
  },

  async getAlbumSongs(albumId: string, signal?: AbortSignal): Promise<Song[]> {
    return getMusicProviderForAlbumId(albumId).getAlbumSongs(albumId, signal);
  },

  async getArtistSongs(artistId: string, signal?: AbortSignal): Promise<Song[]> {
    return getMusicProviderForArtistId(artistId).getArtistSongs(artistId, signal);
  },

  // A discography is one provider's answer about its own artist, so this asks
  // that provider directly instead of federating: no other catalog knows what
  // belongs under this id.
  async getArtistAlbums(artistId: string, signal?: AbortSignal): Promise<Album[]> {
    const provider = getMusicProviderForArtistId(artistId);
    return provider.getArtistAlbums ? provider.getArtistAlbums(artistId, signal) : [];
  },

  search: searchFederated,
  searchAlbums: searchAlbumsFederated,
  searchArtists: searchArtistsFederated,

  async getSongsByTag(tag: string, limit?: number, signal?: AbortSignal): Promise<Song[]> {
    return jamendoProvider.getSongsByTag(tag, limit, signal);
  },

  async getCcmixterSongsByTag(tag: string, limit = 50, signal?: AbortSignal): Promise<FederatedResult<Song>> {
    return federateCatalog([{
      name: 'ccMixter',
      get: () => ccmixterProvider.getSongsByTagWithStatus(tag, limit, signal),
    }], signal);
  },

  async getTrending(limit = 50, signal?: AbortSignal): Promise<FederatedResult<Song>> {
    const providers: Array<CatalogProvider<Song>> = [
      { name: 'Apple Preview', get: async () => ({ results: await itunesProvider.getTrending(limit, signal) }) },
      { name: 'Jamendo', get: async () => ({ results: await jamendoProvider.getTrending(limit, signal) }) },
      { name: 'ccMixter', get: () => ccmixterProvider.getTrendingWithStatus(limit, signal) },
    ];
    return federateCatalog(providers, signal);
  },

  async getChartSongs(chart: ChartKey, signal?: AbortSignal): Promise<Song[]> {
    const data = await providerFetch<{ results?: Song[]; error?: string; unavailable?: boolean }>(
      'Apple Preview',
      'chart',
      '/api/music/charts',
      { chart },
      signal,
    );
    if (data.error) {
      throw new ProviderError('Apple Preview', 'chart', 'upstream', 502, data.error);
    }
    if (!Array.isArray(data.results)) {
      throw new ProviderError('Apple Preview', 'chart', 'invalid_response');
    }
    return data.results;
  },

  async resolveSong(songId: string, signal?: AbortSignal): Promise<Song | null> {
    const provider = getMusicProviderForSongId(songId);
    return provider.getSongById ? provider.getSongById(songId, signal) : null;
  },

  async getStreamUrl(song: Song, signal?: AbortSignal): Promise<string> {
    return getMusicProviderForSongId(song.id).getStreamUrl(song, signal);
  },

  normalizeCoverArt(id: string): string {
    if (!id) return '/placeholder-album.svg';
    if (id.startsWith('/') || id.startsWith('data:image/')) return id;
    try {
      const url = new URL(id);
      return url.protocol === 'https:' ? url.toString() : '/placeholder-album.svg';
    } catch {
      return '/placeholder-album.svg';
    }
  },

  isServerConfigured,
};
