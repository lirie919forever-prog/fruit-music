import type { Album, Artist, Song } from '@/types/music';
import {
  archiveProvider,
  audiusProvider,
  ccmixterProvider,
  deezerProvider,
  getMusicProviderForAlbumId,
  getMusicProviderForArtistId,
  getMusicProviderForSongId,
  itunesProvider,
  jamendoProvider,
  lxmusicProvider,
  openverseProvider,
  radioBrowserProvider,
  somaFmProvider,
  wikimediaProvider,
} from '@/lib/providers';
import type { ProviderCatalogResult } from '@/lib/providers/types';
import { ProviderError, providerFetch } from '@/lib/providers/errors';
import { isLyricsResult, type LyricsResult } from '@/lib/lyrics/lrclib';
import { isSong } from '@/lib/songShape';

function dedupeEntities<T extends { id: string }>(entities: T[]): T[] {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    if (seen.has(entity.id)) return false;
    seen.add(entity.id);
    return true;
  });
}

/**
 * A source-first flat list makes one large provider feel like the whole
 * catalog. Genre shelves should alternate providers where possible, both for
 * variety and so a healthy public source remains visible when Jamendo has not
 * been configured for a local demo.
 */
function interleaveEntities<T extends { id: string }>(groups: T[][], limit: number): T[] {
  const seen = new Set<string>();
  const results: T[] = [];
  const longest = Math.max(0, ...groups.map((group) => group.length));

  for (let index = 0; index < longest && results.length < limit; index += 1) {
    for (const group of groups) {
      const item = group[index];
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      results.push(item);
      if (results.length >= limit) break;
    }
  }

  return results;
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
export type ChartKey = 'billboard' | 'uk' | 'jp';

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
  // Jamendo is deliberately optional in a local Marea install. Treating a
  // missing client id as an outage made every otherwise healthy New page show
  // a permanent warning, which is neither useful nor truthful.
  const notConfigured = settled.map(
    (result) =>
      result.status === 'rejected' && result.reason instanceof ProviderError && result.reason.code === 'not_configured',
  );
  const failedProviders = settled.flatMap((result, index) =>
    result.status === 'rejected' && !notConfigured[index] ? [providers[index].name] : [],
  );
  const degradedProviders = settled.flatMap((result, index) =>
    result.status === 'fulfilled' && result.value.degraded ? [providers[index].name] : [],
  );
  const results = dedupeEntities(
    settled.flatMap((result) => (result.status === 'fulfilled' ? result.value.results : [])),
  );

  return {
    results,
    failedProviders,
    ...(degradedProviders.length > 0 ? { degradedProviders } : {}),
    providerCount: providers.length - notConfigured.filter(Boolean).length,
  };
}

export async function searchFederated(query: string, signal?: AbortSignal): Promise<FederatedSearchResult> {
  // Apple leads the list because it is the only source here that can answer a
  // search for a mainstream release. The Creative Commons providers still run —
  // they carry the full-length recordings Apple only previews — but a query for
  // a song everybody knows used to return nothing at all.
  const providers: Array<CatalogProvider<Song>> = [
    { name: 'Audius', get: async () => ({ results: await audiusProvider.search(query, signal) }) },
    { name: 'Wikimedia Commons', get: async () => ({ results: await wikimediaProvider.search(query, signal) }) },
    { name: 'Jamendo', get: async () => ({ results: await jamendoProvider.search(query, signal) }) },
    { name: 'ccMixter', get: () => ccmixterProvider.searchWithStatus(query, signal) },
    { name: 'Archive', get: async () => ({ results: await archiveProvider.search(query, signal) }) },
    { name: 'Openverse', get: async () => ({ results: await openverseProvider.search(query, signal) }) },
    { name: 'SomaFM', get: async () => ({ results: await somaFmProvider.search(query, signal) }) },
    { name: 'Radio Browser', get: async () => ({ results: await radioBrowserProvider.search(query, signal) }) },
    { name: 'Apple Preview', get: async () => ({ results: await itunesProvider.search(query, signal) }) },
    { name: 'Deezer Preview', get: async () => ({ results: await deezerProvider.search(query, signal) }) },
  ];
  const lxEnabled = process.env.NEXT_PUBLIC_LX_ENABLED === 'true';
  if (lxEnabled) {
    providers.push({ name: 'LX Music', get: async () => ({ results: await lxmusicProvider.search(query, signal) }) });
  }
  return federateCatalog(providers, signal);
}

/**
 * A genre is a discovery request, not a Jamendo-only feature. Apple makes the
 * shelf recognisable with official previews, Audius contributes creator-owned
 * streams, and the Creative Commons providers broaden the long tail. Jamendo
 * remains optional when no local client id is configured.
 */
export async function getGenreSongs(tag: string, limit = 50, signal?: AbortSignal): Promise<FederatedResult<Song>> {
  const normalizedTag = tag.trim();
  if (!normalizedTag) {
    return { results: [], failedProviders: [], providerCount: 0 };
  }

  const normalizedLimit = Number.isFinite(limit) ? Math.floor(limit) : 50;
  const cappedLimit = Math.max(1, Math.min(normalizedLimit, 50));
  // Archive enriches its search records one at a time, so it cannot be treated
  // like a cheap keyword endpoint. Small, balanced pages let nine independent
  // sources contribute without one New-page visit becoming an upstream burst.
  const perProviderLimit = Math.min(20, Math.max(8, Math.ceil(cappedLimit / 9)));
  const providers: Array<CatalogProvider<Song>> = [
    {
      name: 'Audius',
      get: async () => ({ results: await audiusProvider.getSongsByTag(normalizedTag, perProviderLimit, signal) }),
    },
    {
      name: 'Wikimedia Commons',
      get: async () => ({ results: await wikimediaProvider.getSongsByTag(normalizedTag, perProviderLimit, signal) }),
    },
    {
      name: 'Jamendo',
      get: async () => ({ results: await jamendoProvider.getSongsByTag(normalizedTag, perProviderLimit, signal) }),
    },
    {
      name: 'Openverse',
      get: async () => ({ results: await openverseProvider.getSongsByTag(normalizedTag, perProviderLimit, signal) }),
    },
    {
      name: 'SomaFM',
      get: async () => ({ results: await somaFmProvider.getSongsByTag(normalizedTag, perProviderLimit, signal) }),
    },
    {
      name: 'Radio Browser',
      get: async () => ({ results: await radioBrowserProvider.getSongsByTag(normalizedTag, perProviderLimit, signal) }),
    },
    {
      name: 'Apple Preview',
      get: async () => ({ results: await itunesProvider.getSongsByTag(normalizedTag, perProviderLimit, signal) }),
    },
    {
      name: 'Deezer Preview',
      get: async () => ({ results: await deezerProvider.getSongsByTag(normalizedTag, perProviderLimit, signal) }),
    },
  ];
  if (normalizedTag.toLowerCase() === 'classical') {
    providers.push({
      name: 'Archive',
      get: async () => ({ results: await archiveProvider.getSongsByTag(normalizedTag, perProviderLimit, signal) }),
    });
  } else {
    providers.push({
      name: 'ccMixter',
      get: () => ccmixterProvider.getSongsByTagWithStatus(normalizedTag, perProviderLimit, signal),
    });
  }
  const catalog = await federateCatalog(providers, signal);

  return {
    ...catalog,
    results: interleaveEntities(
      providers.map(({ name }) => catalog.results.filter((song) => song.provider === name)),
      cappedLimit,
    ),
  };
}

/**
 * A small, dependable live shelf deserves its own request rather than being a
 * side effect of a much larger trending federation. Both providers deliver
 * continuous audio, so this can be a listener's fastest route into playback
 * while the on-demand catalog is still loading.
 */
export async function getLiveStations(limit = 12, signal?: AbortSignal): Promise<FederatedResult<Song>> {
  const normalizedLimit = Number.isFinite(limit) ? Math.floor(limit) : 12;
  const cappedLimit = Math.max(1, Math.min(normalizedLimit, 24));
  const perProviderLimit = Math.min(20, Math.max(8, Math.ceil(cappedLimit / 2)));
  const providers: Array<CatalogProvider<Song>> = [
    { name: 'SomaFM', get: async () => ({ results: await somaFmProvider.getTrending(perProviderLimit, signal) }) },
    {
      name: 'Radio Browser',
      get: async () => ({ results: await radioBrowserProvider.getTrending(perProviderLimit, signal) }),
    },
  ];
  const catalog = await federateCatalog(providers, signal);

  return {
    ...catalog,
    results: interleaveEntities(
      providers.map(({ name }) => catalog.results.filter((song) => song.provider === name)),
      cappedLimit,
    ),
  };
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
  return federateCatalog(
    [
      { name: 'Audius', get: async () => ({ results: await audiusProvider.searchAlbums(query, signal) }) },
      {
        name: 'Wikimedia Commons',
        get: async () => ({ results: await wikimediaProvider.searchAlbums(query, signal) }),
      },
      { name: 'Jamendo', get: async () => ({ results: await jamendoProvider.searchAlbums(query, signal) }) },
      { name: 'Apple Preview', get: async () => ({ results: await itunesProvider.searchAlbums(query, signal) }) },
      { name: 'Deezer Preview', get: async () => ({ results: await deezerProvider.searchAlbums(query, signal) }) },
    ],
    signal,
  );
}

export async function searchArtistsFederated(query: string, signal?: AbortSignal): Promise<FederatedResult<Artist>> {
  return federateCatalog(
    [
      { name: 'Audius', get: async () => ({ results: await audiusProvider.searchArtists(query, signal) }) },
      {
        name: 'Wikimedia Commons',
        get: async () => ({ results: await wikimediaProvider.searchArtists(query, signal) }),
      },
      { name: 'Jamendo', get: async () => ({ results: await jamendoProvider.searchArtists(query, signal) }) },
      { name: 'Apple Preview', get: async () => ({ results: await itunesProvider.searchArtists(query, signal) }) },
      { name: 'Deezer Preview', get: async () => ({ results: await deezerProvider.searchArtists(query, signal) }) },
    ],
    signal,
  );
}

export function isServerConfigured(): boolean {
  return true;
}

export const api = {
  async getAlbums(signal?: AbortSignal): Promise<FederatedResult<Album>> {
    const providers: Array<CatalogProvider<Album>> = [
      { name: 'Audius', get: async () => ({ results: await audiusProvider.getAlbums(signal) }) },
      { name: 'Wikimedia Commons', get: async () => ({ results: await wikimediaProvider.getAlbums(signal) }) },
      { name: 'Jamendo', get: async () => ({ results: await jamendoProvider.getAlbums(signal) }) },
      { name: 'ccMixter', get: () => ccmixterProvider.getAlbumsWithStatus(signal) },
      { name: 'Apple Preview', get: async () => ({ results: await itunesProvider.getAlbums(signal) }) },
      { name: 'Deezer Preview', get: async () => ({ results: await deezerProvider.getAlbums(signal) }) },
    ];
    return federateCatalog(providers, signal);
  },

  async getArtists(signal?: AbortSignal): Promise<FederatedResult<Artist>> {
    const providers: Array<CatalogProvider<Artist>> = [
      { name: 'Audius', get: async () => ({ results: await audiusProvider.getArtists(signal) }) },
      { name: 'Wikimedia Commons', get: async () => ({ results: await wikimediaProvider.getArtists(signal) }) },
      { name: 'Jamendo', get: async () => ({ results: await jamendoProvider.getArtists(signal) }) },
      { name: 'ccMixter', get: () => ccmixterProvider.getArtistsWithStatus(signal) },
      { name: 'Apple Preview', get: async () => ({ results: await itunesProvider.getArtists(signal) }) },
      { name: 'Deezer Preview', get: async () => ({ results: await deezerProvider.getArtists(signal) }) },
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
    return (await getGenreSongs(tag, limit, signal)).results;
  },

  getGenreSongs,

  getLiveStations,

  async getRecentReleases(limit = 20, signal?: AbortSignal): Promise<Song[]> {
    return itunesProvider.getRecentReleases(limit, signal);
  },

  async getCcmixterSongsByTag(tag: string, limit = 50, signal?: AbortSignal): Promise<FederatedResult<Song>> {
    return federateCatalog(
      [
        {
          name: 'ccMixter',
          get: () => ccmixterProvider.getSongsByTagWithStatus(tag, limit, signal),
        },
      ],
      signal,
    );
  },

  async getTrending(limit = 50, signal?: AbortSignal): Promise<FederatedResult<Song>> {
    const requestedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 50;
    const providers: Array<CatalogProvider<Song>> = [
      { name: 'Audius', get: async () => ({ results: await audiusProvider.getTrending(requestedLimit, signal) }) },
      {
        name: 'Wikimedia Commons',
        get: async () => ({ results: await wikimediaProvider.getTrending(requestedLimit, signal) }),
      },
      { name: 'Jamendo', get: async () => ({ results: await jamendoProvider.getTrending(requestedLimit, signal) }) },
      { name: 'ccMixter', get: () => ccmixterProvider.getTrendingWithStatus(requestedLimit, signal) },
      { name: 'Archive', get: async () => ({ results: await archiveProvider.getTrending(requestedLimit, signal) }) },
      {
        name: 'Openverse',
        get: async () => ({ results: await openverseProvider.getTrending(requestedLimit, signal) }),
      },
      { name: 'SomaFM', get: async () => ({ results: await somaFmProvider.getTrending(requestedLimit, signal) }) },
      {
        name: 'Radio Browser',
        get: async () => ({ results: await radioBrowserProvider.getTrending(requestedLimit, signal) }),
      },
      {
        name: 'Apple Preview',
        get: async () => ({ results: await itunesProvider.getTrending(requestedLimit, signal) }),
      },
      {
        name: 'Deezer Preview',
        get: async () => ({ results: await deezerProvider.getTrending(requestedLimit, signal) }),
      },
    ];
    const catalog = await federateCatalog(providers, signal);

    return {
      ...catalog,
      results: interleaveEntities(
        providers.map(({ name }) => catalog.results.filter((song) => song.provider === name)),
        requestedLimit,
      ),
    };
  },

  async getChartSongs(chart: ChartKey, signal?: AbortSignal): Promise<Song[]> {
    const data = await providerFetch<{ results?: unknown; error?: string; unavailable?: boolean }>(
      'Apple Preview',
      'chart',
      '/api/music/charts',
      { chart },
      signal,
      { timeoutMs: 15_000 },
    );
    if (data.error) {
      throw new ProviderError('Apple Preview', 'chart', 'upstream', 502, data.error);
    }
    if (!Array.isArray(data.results)) {
      throw new ProviderError('Apple Preview', 'chart', 'invalid_response');
    }
    // Every other provider maps its upstream through a shape check on the way
    // in; this one used to cast the JSON body to `Song[]` and hand it to the
    // UI. It is still a network response, and it is the only path that skipped
    // that step. A malformed entry is dropped rather than allowed to throw
    // inside a row; a body with nothing usable in it is a failure, not an
    // empty chart.
    const results = data.results.filter(isSong);
    if (results.length === 0) {
      throw new ProviderError('Apple Preview', 'chart', 'invalid_response');
    }
    return results;
  },

  /**
   * Lyrics for a track, or `null` when nobody has them.
   *
   * "Nobody has them" is the common answer — most of this catalog is Creative
   * Commons music that LRCLIB has never been asked about — so a miss is a
   * normal result rather than an error. Only a server that could not answer at
   * all throws, which is what lets the panel tell "no lyrics exist" apart from
   * "the lookup is broken".
   */
  async getLyrics(song: Song, signal?: AbortSignal): Promise<LyricsResult | null> {
    const data = await providerFetch<{ found?: boolean; lyrics?: unknown }>(
      'LRCLIB',
      'lyrics',
      '/api/lyrics',
      {
        track: song.title,
        artist: song.artist,
        ...(song.album ? { album: song.album } : {}),
        duration: String(song.duration),
      },
      signal,
    );
    return data.found === true && isLyricsResult(data.lyrics) ? data.lyrics : null;
  },

  async resolveSong(songId: string, signal?: AbortSignal): Promise<Song | null> {
    const provider = getMusicProviderForSongId(songId);
    return provider.getSongById ? provider.getSongById(songId, signal) : null;
  },

  async getStreamUrl(song: Song, signal?: AbortSignal): Promise<string> {
    return getMusicProviderForSongId(song.id).getStreamUrl(song, signal);
  },

  isServerConfigured,
};
