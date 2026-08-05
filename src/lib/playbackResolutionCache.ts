import type { Song } from '@/types/music';

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 128;

export interface PlaybackResolutionCacheEntry {
  candidates: Song[];
  selectedId?: string;
  streamUrl?: string;
  expiresAt: number;
}

const cache = new Map<string, PlaybackResolutionCacheEntry>();

function cacheKey(song: Pick<Song, 'id' | 'provider' | 'title' | 'artist'>): string {
  return [song.provider, song.id, song.title.trim().toLocaleLowerCase(), song.artist.trim().toLocaleLowerCase()].join(
    '|',
  );
}

function isFresh(entry: PlaybackResolutionCacheEntry | undefined): entry is PlaybackResolutionCacheEntry {
  return Boolean(entry && entry.expiresAt > Date.now());
}

function trimCache(): void {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== 'string') return;
    cache.delete(oldestKey);
  }
}

export function getPlaybackResolution(
  song: Pick<Song, 'id' | 'provider' | 'title' | 'artist'>,
): PlaybackResolutionCacheEntry | null {
  const key = cacheKey(song);
  const entry = cache.get(key);
  if (!isFresh(entry)) {
    if (entry) cache.delete(key);
    return null;
  }

  // Refresh insertion order so frequently used tracks stay in the bounded map.
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

export function setPlaybackResolution(
  song: Pick<Song, 'id' | 'provider' | 'title' | 'artist'>,
  entry: Omit<PlaybackResolutionCacheEntry, 'expiresAt'>,
): void {
  const key = cacheKey(song);
  cache.delete(key);
  cache.set(key, {
    ...entry,
    candidates: entry.candidates.slice(),
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  trimCache();
}

export function clearPlaybackResolutionCache(): void {
  cache.clear();
}
