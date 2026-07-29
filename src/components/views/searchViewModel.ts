import type { MusicProviderName, Song } from '@/types/music';
import { filterSongsByAccess, type AudioAccessMode } from './newViewModel';

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
  SomaFM: 12,
  'Radio Browser': 10,
};

const LOW_SIGNAL_TITLE =
  /\b(official (audio|video)|lyrics?|extended|nightcore|slowed|reverb|type beat|karaoke)\b|\[[a-z0-9_-]{8,}\]/i;
const TRAILING_UPLOAD_ID = /\s*\[[a-z0-9_-]{8,}\]\s*$/i;

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
    phraseScore(artist, query, 720, 500, 310) +
    phraseScore(title, query, 620, 430, 250) +
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
export function rankSearchSongs(songs: Song[], query: string): Song[] {
  const normalizedQuery = normalize(query);
  const ranked = songs
    .map((song, index) => ({ song, index, score: score(song, normalizedQuery) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const seen = new Set<string>();

  return ranked.flatMap(({ song }) => {
    const key = identity(song);
    if (seen.has(key)) return [];
    seen.add(key);
    return [song];
  });
}

export function rankSearchSongsForAccess(songs: Song[], query: string, mode: AudioAccessMode): Song[] {
  return rankSearchSongs(filterSongsByAccess(songs, mode), query);
}

export function splitTopSearchMatches(songs: Song[], limit = 6): { topMatches: Song[]; remainingTracks: Song[] } {
  const cappedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 6;
  return {
    topMatches: songs.slice(0, cappedLimit),
    remainingTracks: songs.slice(cappedLimit),
  };
}
