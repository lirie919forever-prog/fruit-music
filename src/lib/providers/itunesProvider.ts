import type { MusicProvider } from './types';
import { providerFetch } from './errors';
import { safeCoverArt } from '@/lib/coverArt';
import type { Album, Artist, Song } from '@/types/music';

const PROXY_BASE = '/api/music/itunes';

/**
 * Apple serves every preview as a fixed-length clip rather than the full
 * recording. `trackTimeMillis` is the length of the song you would buy, so
 * writing it into `Song.duration` would put "3:48" beside a row that stops at
 * thirty seconds. The duration reported here is the duration that actually
 * plays; the full length is not shown at all rather than shown misleadingly.
 */
const PREVIEW_DURATION_SECONDS = 30;
const PREVIEW_LICENSE = '30-second preview';
const APPLE_CATALOG_TIMEOUT_MS = 15_000;
export type ItunesCountry = 'gb' | 'jp' | 'us';
const SEARCH_COUNTRIES: readonly ItunesCountry[] = ['jp', 'us'];

/** Apple's artwork URLs carry their size in the filename, so any size is one substitution away. */
const ARTWORK_SIZE = /\/\d+x\d+bb\.(jpg|png)$/;

export interface ItunesTrack {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  trackName?: string;
  artistId?: number;
  artistName?: string;
  collectionId?: number;
  collectionName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  trackNumber?: number;
  releaseDate?: string;
  primaryGenreName?: string;
  trackViewUrl?: string;
  artistViewUrl?: string;
  collectionViewUrl?: string;
  trackCount?: number;
  trackTimeMillis?: number;
}

function artworkAt(url: string | undefined, size: number): string {
  if (!url) return '/placeholder-album.svg';
  return safeCoverArt(ARTWORK_SIZE.test(url) ? url.replace(ARTWORK_SIZE, `/${size}x${size}bb.$1`) : url);
}

function releaseYear(value: string | undefined): number {
  return value ? Number(value.slice(0, 4)) || 0 : 0;
}

/**
 * A record is only usable if it can actually be played and identified. Apple
 * returns collection and artist wrappers inside track responses, and a handful
 * of songs carry no preview at all; both are dropped rather than rendered as
 * rows that fail when clicked.
 */
export function isPlayableTrack(item: ItunesTrack): boolean {
  return (
    item.wrapperType === 'track' &&
    item.kind === 'song' &&
    typeof item.trackId === 'number' &&
    Boolean(item.trackName) &&
    typeof item.artistId === 'number' &&
    Boolean(item.artistName) &&
    typeof item.collectionId === 'number' &&
    Boolean(item.previewUrl)
  );
}

export function itunesSongId(trackId: number | string): string {
  return `itunes-${trackId}`;
}

export function trackToSong(
  item: ItunesTrack,
  index = 0,
  durationSeconds = PREVIEW_DURATION_SECONDS,
  country: ItunesCountry = 'us',
): Song {
  const trackId = String(item.trackId);
  const recordingDuration =
    typeof item.trackTimeMillis === 'number' && Number.isFinite(item.trackTimeMillis) && item.trackTimeMillis > 0
      ? Math.round(item.trackTimeMillis / 1000)
      : undefined;
  return {
    id: itunesSongId(trackId),
    title: item.trackName!,
    artist: item.artistName!,
    artistId: `itunes-artist-${item.artistId}`,
    album: item.collectionName || item.trackName!,
    albumId: `itunes-album-${item.collectionId}`,
    coverArt: artworkAt(item.artworkUrl100, 600),
    duration: durationSeconds,
    ...(recordingDuration ? { recordingDuration } : {}),
    track: item.trackNumber ?? index + 1,
    year: releaseYear(item.releaseDate),
    genre: item.primaryGenreName || '',
    path: `${PROXY_BASE}/stream/${trackId}${country === 'us' ? '' : `?country=${country}`}`,
    bitRate: 0,
    contentType: 'audio/mp4',
    suffix: 'm4a',
    size: 0,
    provider: 'Apple Preview',
    sourceUrl: item.trackViewUrl || '',
    creatorUrl: item.artistViewUrl || '',
    licenseName: PREVIEW_LICENSE,
    licenseUrl: 'https://www.apple.com/legal/internet-services/itunes/',
    attributionUrl: item.trackViewUrl || '',
    metadataVerified: true,
  };
}

function collectionToAlbum(item: ItunesTrack): Album | null {
  if (item.wrapperType !== 'collection' || typeof item.collectionId !== 'number' || !item.collectionName) return null;
  return {
    id: `itunes-album-${item.collectionId}`,
    name: item.collectionName,
    artist: item.artistName || 'Unknown',
    artistId: `itunes-artist-${item.artistId}`,
    coverArt: artworkAt(item.artworkUrl100, 600),
    songCount: item.trackCount ?? 0,
    duration: 0,
    year: releaseYear(item.releaseDate),
    genre: item.primaryGenreName || '',
  };
}

async function itunesFetch(
  resource: 'search' | 'lookup',
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<ItunesTrack[]> {
  const data = await providerFetch<{ results?: ItunesTrack[] }>(
    'Apple Preview',
    resource,
    `${PROXY_BASE}/${resource}`,
    params,
    signal,
    { timeoutMs: APPLE_CATALOG_TIMEOUT_MS },
  );
  return Array.isArray(data?.results) ? data.results : [];
}

interface ItunesCountryResults {
  country: ItunesCountry;
  results: ItunesTrack[];
}

/**
 * Apple's search catalog is territory-specific. Query Japan and the US in
 * parallel so a romanized artist name such as YOASOBI or Aimer still reaches
 * the Japanese catalog, while English mainstream searches keep their wider US
 * coverage. A failed territory is allowed to degrade without hiding the
 * healthy one.
 */
async function itunesSearchAcrossCountries(
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<ItunesCountryResults[]> {
  const settled = await Promise.allSettled(
    SEARCH_COUNTRIES.map(async (country) => ({
      country,
      results: await itunesFetch('search', { ...params, country }, signal),
    })),
  );
  const fulfilled = settled.filter(
    (result): result is PromiseFulfilledResult<ItunesCountryResults> => result.status === 'fulfilled',
  );
  if (fulfilled.length === 0) {
    const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    throw failure?.reason instanceof Error ? failure.reason : new Error('Apple search is unavailable');
  }
  return fulfilled.map((result) => result.value);
}

function songsFromCountries(groups: ItunesCountryResults[]): Song[] {
  const seen = new Set<string>();
  return groups.flatMap(({ country, results }) =>
    results
      .filter(isPlayableTrack)
      .map((item, index) => trackToSong(item, index, PREVIEW_DURATION_SECONDS, country))
      .filter((song) => {
        if (seen.has(song.id)) return false;
        seen.add(song.id);
        return true;
      }),
  );
}

function songsFrom(results: ItunesTrack[]): Song[] {
  return results.filter(isPlayableTrack).map((item, index) => trackToSong(item, index));
}

/**
 * Apple lists the same release under several collection ids — a remix single
 * reissued per territory, a soundtrack cut re-registered by its label. Those
 * share a name and an artist, so they collapse here: two tiles with identical
 * artwork and identical text read as a rendering bug, not as a catalog fact.
 */
function albumsFrom(results: ItunesTrack[]): Album[] {
  const byIdentity = new Map<string, Album>();
  for (const item of results) {
    const album = collectionToAlbum(item);
    if (!album) continue;
    const identity = `${album.name.toLowerCase()}|${album.artist.toLowerCase()}`;
    if (!byIdentity.has(identity)) byIdentity.set(identity, album);
  }
  return [...byIdentity.values()];
}

/**
 * Folds album records down to the artists behind them, borrowing one release's
 * cover as the artist's image. Apple's artist records carry no artwork at all,
 * so this is the only way to show an artist as anything but a blank circle.
 */
function artistsFrom(results: ItunesTrack[]): Artist[] {
  const byArtist = new Map<string, Artist>();
  for (const item of results) {
    if (item.wrapperType !== 'collection' || typeof item.artistId !== 'number' || !item.artistName) continue;
    const id = `itunes-artist-${item.artistId}`;
    const existing = byArtist.get(id);
    if (existing) existing.albumCount += 1;
    else byArtist.set(id, { id, name: item.artistName, coverArt: artworkAt(item.artworkUrl100, 600), albumCount: 1 });
  }
  return [...byArtist.values()];
}

/**
 * The browse shelves need a catalog with no query behind it. Apple has no
 * "everything" endpoint, so the seeds below stand in for one: each is a broad
 * term that returns a different slice of the catalog, and rotating through them
 * gives the album and artist grids real variety instead of one genre repeated.
 */
const BROWSE_SEEDS = ['pop', 'rock', 'hip-hop', 'jazz', 'classical', 'electronic', 'r&b', 'country'];

/**
 * The Search API has no "new releases" sort. These broad terms bring back
 * separate slices of the live catalog; sorting the playable results by Apple's
 * release timestamp gives the New page a useful, live recent-release rail
 * without inventing dates or depending on a private feed.
 */
function recentReleaseSeeds(limit: number): string[] {
  const year = new Date().getUTCFullYear();
  const seeds = [String(year), 'j-pop', 'new music', 'pop', String(year - 1)];
  // The New page only needs a compact rail. Two broad, current queries are
  // enough for small requests, and larger consumers can opt into the wider
  // live catalog without paying ten upstream requests by default.
  const seedCount = limit <= 12 ? 2 : limit <= 24 ? 3 : seeds.length;
  return seeds.slice(0, seedCount);
}

function seedFor(offset: number): string {
  return BROWSE_SEEDS[offset % BROWSE_SEEDS.length];
}

/** Runs several seed queries at once and keeps whatever came back, so one failed seed does not empty the shelf. */
async function gatherSeeds<T>(count: number, fetchSeed: (seed: string) => Promise<T[]>): Promise<T[]> {
  const settled = await Promise.allSettled(Array.from({ length: count }, (_, index) => fetchSeed(seedFor(index))));
  return settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
}

interface ItunesProvider extends Required<
  Omit<
    MusicProvider,
    | 'getAlbumsWithStatus'
    | 'getArtistsWithStatus'
    | 'searchWithStatus'
    | 'getSongsByTagWithStatus'
    | 'getTrendingWithStatus'
    | 'lastCatalogDegraded'
  >
> {
  getSongsByIds(trackIds: string[], signal?: AbortSignal): Promise<Song[]>;
  getRecentReleases(limit?: number, signal?: AbortSignal): Promise<Song[]>;
}

export const itunesProvider: ItunesProvider = {
  async search(query: string, signal?: AbortSignal): Promise<Song[]> {
    if (!query.trim()) return [];
    return songsFromCountries(await itunesSearchAcrossCountries({ term: query, entity: 'song', limit: '40' }, signal));
  },

  async getSongsByTag(tag: string, limit = 50, signal?: AbortSignal): Promise<Song[]> {
    return songsFromCountries(
      await itunesSearchAcrossCountries({ term: tag, entity: 'song', limit: String(limit) }, signal),
    ).slice(0, Math.max(1, Math.floor(limit)));
  },

  async getRecentReleases(limit = 20, signal?: AbortSignal): Promise<Song[]> {
    const normalizedLimit = Number.isFinite(limit) ? Math.floor(limit) : 20;
    const cappedLimit = Math.max(1, Math.min(normalizedLimit, 50));
    const settled = await Promise.allSettled(
      recentReleaseSeeds(cappedLimit).flatMap((term) =>
        SEARCH_COUNTRIES.map(async (country) => ({
          country,
          results: await itunesFetch('search', { term, entity: 'song', limit: '40', country }, signal),
        })),
      ),
    );
    const fulfilled = settled.filter(
      (result): result is PromiseFulfilledResult<ItunesCountryResults> => result.status === 'fulfilled',
    );
    if (fulfilled.length === 0) {
      const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      throw failure?.reason instanceof Error ? failure.reason : new Error('Apple recent releases are unavailable');
    }
    const candidates = fulfilled
      .flatMap((result) =>
        result.value.results.filter(isPlayableTrack).map((track) => ({ track, country: result.value.country })),
      )
      .sort((left, right) => {
        const leftRelease = Date.parse(left.track.releaseDate || '');
        const rightRelease = Date.parse(right.track.releaseDate || '');
        return (Number.isFinite(rightRelease) ? rightRelease : 0) - (Number.isFinite(leftRelease) ? leftRelease : 0);
      });
    const seen = new Set<string>();
    const releases: Song[] = [];

    for (const { track, country } of candidates) {
      const songId = itunesSongId(track.trackId!);
      if (seen.has(songId)) continue;
      seen.add(songId);
      releases.push(trackToSong(track, releases.length, PREVIEW_DURATION_SECONDS, country));
      if (releases.length >= cappedLimit) break;
    }

    return releases;
  },

  /**
   * What is actually trending, not what a search for "pop" returns.
   *
   * This reads the US chart rather than the search endpoint because Apple
   * publishes a real most-played feed and a keyword search does not approximate
   * one — it returns whatever matches the word, ordered by relevance, which on
   * a discovery shelf reads as an arbitrary sample of the catalog.
   */
  async getTrending(limit = 50, signal?: AbortSignal): Promise<Song[]> {
    const data = await providerFetch<{ results?: Song[]; error?: string }>(
      'Apple Preview',
      'trending',
      '/api/music/charts',
      { chart: 'billboard' },
      signal,
      { timeoutMs: APPLE_CATALOG_TIMEOUT_MS },
    );
    return Array.isArray(data?.results) ? data.results.slice(0, limit) : [];
  },

  async getAlbums(signal?: AbortSignal): Promise<Album[]> {
    const results = await gatherSeeds(4, (seed) =>
      itunesFetch('search', { term: seed, entity: 'album', limit: '25' }, signal),
    );
    return albumsFrom(results);
  },

  async searchAlbums(query: string, signal?: AbortSignal): Promise<Album[]> {
    if (!query.trim()) return [];
    const groups = await itunesSearchAcrossCountries({ term: query, entity: 'album', limit: '24' }, signal);
    return albumsFrom(groups.flatMap(({ results }) => results));
  },

  /**
   * Artists are derived from an album search rather than taken from
   * `entity=musicArtist`.
   *
   * Apple's artist records carry a name and a genre and nothing else — no
   * artwork of any kind — so a dedicated artist search returns a page of blank
   * circles. Album results carry the artist id alongside real cover art, which
   * is the same substitution `getArtists` already makes for the browse grid.
   */
  async searchArtists(query: string, signal?: AbortSignal): Promise<Artist[]> {
    if (!query.trim()) return [];
    const groups = await itunesSearchAcrossCountries({ term: query, entity: 'album', limit: '25' }, signal);
    return artistsFrom(groups.flatMap(({ results }) => results));
  },

  /**
   * The artist's own records, not everything they appear on.
   *
   * Apple's album lookup returns every release the artist is credited on, so
   * Daft Punk's page came back carrying The Weeknd's "Starboy" single and a
   * Junior Kimbrough EP. Those are real credits but they are not this artist's
   * discography, and under a heading that says "Albums" they read as an error.
   * A collection's `artistId` is its primary artist, which is exactly the test.
   */
  async getArtistAlbums(artistId: string, signal?: AbortSignal): Promise<Album[]> {
    const id = artistId.replace('itunes-artist-', '');
    const results = await itunesFetch('lookup', { id, entity: 'album', limit: '100' }, signal);
    const own = results.filter((item) => String(item.artistId) === id);
    return albumsFrom(own).sort((left, right) => right.year - left.year);
  },

  async getAlbumById(albumId: string, signal?: AbortSignal): Promise<Album | null> {
    const id = albumId.replace('itunes-album-', '');
    const results = await itunesFetch('lookup', { id, entity: 'song', limit: '1' }, signal);
    return results.map(collectionToAlbum).find((album): album is Album => album !== null) ?? null;
  },

  async getAlbumSongs(albumId: string, signal?: AbortSignal): Promise<Song[]> {
    const id = albumId.replace('itunes-album-', '');
    const results = await itunesFetch('lookup', { id, entity: 'song', limit: '200' }, signal);
    return songsFrom(results).sort((left, right) => left.track - right.track);
  },

  async getArtists(signal?: AbortSignal): Promise<Artist[]> {
    const results = await gatherSeeds(4, (seed) =>
      itunesFetch('search', { term: seed, entity: 'album', limit: '25' }, signal),
    );
    return artistsFrom(results);
  },

  async getArtistById(artistId: string, signal?: AbortSignal): Promise<Artist | null> {
    const id = artistId.replace('itunes-artist-', '');
    const results = await itunesFetch('lookup', { id, entity: 'song', limit: '25' }, signal);
    const artist = results.find((item) => item.wrapperType === 'artist' && Boolean(item.artistName));
    if (!artist) return null;
    const cover = results.find(isPlayableTrack)?.artworkUrl100;
    return {
      id: artistId,
      name: artist.artistName!,
      coverArt: artworkAt(cover, 600),
      albumCount: new Set(results.filter(isPlayableTrack).map((item) => item.collectionId)).size,
    };
  },

  async getArtistSongs(artistId: string, signal?: AbortSignal): Promise<Song[]> {
    const id = artistId.replace('itunes-artist-', '');
    return songsFrom(await itunesFetch('lookup', { id, entity: 'song', limit: '50' }, signal));
  },

  async getSongById(songId: string, signal?: AbortSignal): Promise<Song | null> {
    const id = songId.replace('itunes-', '');
    const results = await itunesFetch('lookup', { id, entity: 'song', limit: '1' }, signal);
    const track = results.find((item) => isPlayableTrack(item) && String(item.trackId) === id);
    return track ? trackToSong(track) : null;
  },

  /**
   * Resolves many track ids in one request. The chart feeds hand back Apple
   * track ids, so a whole chart becomes a single lookup instead of one
   * fuzzy-matched search per entry.
   */
  async getSongsByIds(trackIds: string[], signal?: AbortSignal): Promise<Song[]> {
    if (!trackIds.length) return [];
    const chunks: string[][] = [];
    for (let index = 0; index < trackIds.length; index += 50) {
      chunks.push(trackIds.slice(index, index + 50));
    }
    const settled = await Promise.allSettled(
      chunks.map((chunk) => itunesFetch('lookup', { id: chunk.join(','), entity: 'song', limit: '200' }, signal)),
    );
    const byId = new Map<string, Song>();
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      for (const song of songsFrom(result.value)) byId.set(song.id, song);
    }
    // Chart order is the point of a chart, so results are re-sorted back into
    // the order the ids arrived in rather than the order Apple returned them.
    return trackIds
      .map((trackId) => byId.get(itunesSongId(trackId)))
      .filter((song): song is Song => song !== undefined);
  },

  async getStreamUrl(song: Song): Promise<string> {
    return song.path;
  },
};
