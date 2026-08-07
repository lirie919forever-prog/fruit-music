import type { Album, Artist, MusicProviderName, Song } from '@/types/music';
import { filterSongsByAccess, isDirectFullTrack, type AudioAccessMode } from './newViewModel';

const PROVIDER_RELEVANCE: Record<MusicProviderName, number> = {
  'Apple Preview': 55,
  'Deezer Preview': 50,
  Jamendo: 42,
  'Wikimedia Commons': 39,
  Archive: 37,
  ccMixter: 35,
  Openverse: 32,
  Audius: 24,
  'LX Music': 16,
  Kuwo: 45,
  SomaFM: 12,
  'NTS Radio': 14,
  'Radio Paradise': 16,
  KEXP: 15,
  FIP: 15,
  'The Current': 15,
  'Radio Browser': 10,
  'Local file': 100,
};

const LOW_SIGNAL_TITLE =
  /\b(official (audio|video)|lyrics?|extended|nightcore|slowed|reverb|type beat|karaoke)\b|\[[a-z0-9_-]{8,}\]/i;
const TRAILING_UPLOAD_ID = /\s*\[[a-z0-9_-]{8,}\]\s*$/i;

const ENTITY_PROVIDER_RELEVANCE: Record<string, number> = {
  itunes: 90,
  deezer: 85,
  kuwo: 78,
  audius: 70,
  jamendo: 64,
  ccmixter: 58,
  archive: 52,
  openverse: 48,
  wikimedia: 44,
  lxmusic: 40,
};

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function phraseScore(value: string, query: string, exact: number, startsWith: number, includes: number): number {
  if (!value || !query) return 0;
  if (value === query) return exact;
  if (value.startsWith(query)) return startsWith;
  return value.includes(query) ? includes : 0;
}

function tokenScore(value: string, query: string): number {
  const tokens = query.split(' ').filter((token) => token.length > 1);
  return tokens.reduce((score, token) => score + (value.includes(token) ? 18 : 0), 0);
}

function score(song: Song, query: string): number {
  const title = normalize(song.title);
  const artist = normalize(song.artist);
  const relevance =
    // An exact title is the strongest signal for a track search. Keep an
    // exact artist match close behind so a song named after the artist still
    // loses to the actual artist record when provider quality differs.
    phraseScore(artist, query, 680, 500, 310) +
    phraseScore(title, query, 850, 430, 250) +
    // A one-word artist query often appears at the start of noisy upload
    // titles. Give an exact artist identity enough weight to beat those title
    // prefixes while keeping an exact song title the strongest song signal.
    (artist === query ? 160 : 0) +
    tokenScore(artist, query) +
    tokenScore(title, query);
  const quality =
    PROVIDER_RELEVANCE[song.provider] +
    (song.metadataVerified ? 12 : -10) +
    (song.duration > 0 ? 4 : 0) +
    (song.isLive ? -28 : 0) +
    (song.playbackUnavailable ? -500 : 0) +
    (LOW_SIGNAL_TITLE.test(song.title) ? -36 : 0);

  return relevance + quality;
}

function identity(song: Song): string {
  const canonicalTitle = normalize(song.title.replace(TRAILING_UPLOAD_ID, '')) || normalize(song.title);
  return `${canonicalTitle}\u0000${normalize(song.artist)}`;
}

export function areAllSearchProvidersUnavailable(state: {
  results: readonly unknown[];
  failedProviders: readonly string[];
  degradedProviders?: readonly string[];
  providerCount: number;
}): boolean {
  if (state.results.length > 0 || state.providerCount <= 0) return false;
  const unavailableProviders = new Set([...state.failedProviders, ...(state.degradedProviders ?? [])]);
  return unavailableProviders.size >= state.providerCount;
}

/**
 * A provider can return a correct match while a user upload with the same
 * title and artist is listed first. Rank before de-duplicating so the more
 * dependable record survives, then keep stable source order for ties.
 */
function rankSearchSongsInternal(songs: Song[], query: string, preferFullDuplicates: boolean): Song[] {
  const normalizedQuery = normalize(query);
  const ranked = songs
    .map((song, index) => ({ song, index, score: score(song, normalizedQuery) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((candidate, rank) => ({ ...candidate, rank }));
  const selected = new Map<string, (typeof ranked)[number]>();

  for (const candidate of ranked) {
    const key = identity(candidate.song);
    const existing = selected.get(key);
    if (!existing) {
      selected.set(key, candidate);
      continue;
    }

    const candidateIsPlayableFull =
      preferFullDuplicates &&
      candidate.song.playbackUnavailable !== true &&
      !candidate.song.isLive &&
      isDirectFullTrack(candidate.song);
    const existingIsPlayableFull =
      preferFullDuplicates &&
      existing.song.playbackUnavailable !== true &&
      !existing.song.isLive &&
      isDirectFullTrack(existing.song);
    if (candidateIsPlayableFull && !existingIsPlayableFull) {
      selected.set(key, { ...candidate, rank: existing.rank });
    }
  }

  return [...selected.values()].sort((left, right) => left.rank - right.rank).map(({ song }) => song);
}

export function rankSearchSongs(songs: Song[], query: string): Song[] {
  return rankSearchSongsInternal(songs, query, false);
}

export function rankSearchSongsForAccess(songs: Song[], query: string, mode: AudioAccessMode): Song[] {
  return rankSearchSongsInternal(filterSongsByAccess(songs, mode), query, mode === 'all');
}

function entityProviderScore(id: string): number {
  const prefix = id.toLocaleLowerCase().split('-')[0];
  return ENTITY_PROVIDER_RELEVANCE[prefix] ?? 0;
}

function entityScore(name: string, artist: string, query: string, id: string, isAlbum: boolean): number {
  const normalizedName = normalize(name);
  const normalizedArtist = normalize(artist);
  const nameRelevance = phraseScore(normalizedName, query, 1_000, 700, 360) + tokenScore(normalizedName, query);
  const artistRelevance = isAlbum
    ? phraseScore(normalizedArtist, query, 620, 430, 260) + tokenScore(normalizedArtist, query)
    : 0;
  return nameRelevance + artistRelevance + entityProviderScore(id);
}

function rankAndDedupeEntities<T extends { id: string }>(
  entities: T[],
  query: string,
  getName: (entity: T) => string,
  getArtist: (entity: T) => string,
  getIdentity: (entity: T) => string,
  isAlbum: boolean,
): T[] {
  const normalizedQuery = normalize(query);
  const ranked = entities
    .map((entity, index) => ({
      entity,
      index,
      score: entityScore(getName(entity), getArtist(entity), normalizedQuery, entity.id, isAlbum),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = new Map<string, (typeof ranked)[number]>();

  for (const candidate of ranked) {
    const key = getIdentity(candidate.entity) || `id:${candidate.entity.id}`;
    if (!selected.has(key)) selected.set(key, candidate);
  }

  return [...selected.values()].map(({ entity }) => entity);
}

/** Search providers often return the same artist under different provider ids. */
export function rankSearchArtists(artists: Artist[], query: string): Artist[] {
  return rankAndDedupeEntities(
    artists,
    query,
    (artist) => artist.name,
    () => '',
    (artist) => normalize(artist.name),
    false,
  );
}

/** Keep distinct releases, but collapse the same album returned by multiple sources. */
export function rankSearchAlbums(albums: Album[], query: string): Album[] {
  return rankAndDedupeEntities(
    albums,
    query,
    (album) => album.name,
    (album) => album.artist,
    (album) => `${normalize(album.name)}\u0000${normalize(album.artist)}`,
    true,
  );
}

export type SearchProviderStatus = 'results' | 'no-match' | 'partial' | 'unavailable';

export interface SearchProviderSummary {
  name: string;
  resultCount: number;
  status: SearchProviderStatus;
}

/** Convert federation metadata into a compact status model for the search UI. */
export function summarizeSearchProviders(
  providerNames: readonly string[],
  results: readonly Song[],
  failedProviders: readonly string[] = [],
  degradedProviders: readonly string[] = [],
): SearchProviderSummary[] {
  const resultCounts = new Map<string, number>();
  for (const song of results) resultCounts.set(song.provider, (resultCounts.get(song.provider) ?? 0) + 1);
  const failed = new Set(failedProviders);
  const degraded = new Set(degradedProviders);

  return providerNames.map((name) => {
    const resultCount = resultCounts.get(name) ?? 0;
    const status: SearchProviderStatus = failed.has(name)
      ? 'unavailable'
      : degraded.has(name)
        ? 'partial'
        : resultCount > 0
          ? 'results'
          : 'no-match';
    return { name, resultCount, status };
  });
}

export function splitTopSearchMatches(songs: Song[], limit = 6): { topMatches: Song[]; remainingTracks: Song[] } {
  const cappedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 6;
  return {
    topMatches: songs.slice(0, cappedLimit),
    remainingTracks: songs.slice(cappedLimit),
  };
}
