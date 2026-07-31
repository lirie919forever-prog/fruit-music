import type { Song } from '@/types/music';

export type AudioAccessMode = 'all' | 'full' | 'preview';

export function isPreviewProvider(provider: Song['provider']): boolean {
  return provider === 'Apple Preview' || provider === 'Deezer Preview';
}

export function isPreviewOnlyEntityId(id: string): boolean {
  return id.startsWith('itunes-') || id.startsWith('deezer-');
}

export function isFullTrack(song: Song): boolean {
  return !isPreviewProvider(song.provider) && !isPreviewOnlyEntityId(song.id);
}

export function uniqueSongs(songs: Song[]): Song[] {
  const seen = new Set<string>();
  return songs.filter((song) => {
    if (seen.has(song.id)) return false;
    seen.add(song.id);
    return true;
  });
}

export function interleaveSongGroups(groups: Array<Song[] | undefined>, limit = Number.POSITIVE_INFINITY): Song[] {
  const populatedGroups = groups.filter((group): group is Song[] => Boolean(group?.length));
  const maxLength = Math.max(0, ...populatedGroups.map((group) => group.length));
  const seen = new Set<string>();
  const songs: Song[] = [];

  for (let index = 0; index < maxLength && songs.length < limit; index++) {
    for (const group of populatedGroups) {
      const song = group[index];
      if (!song || seen.has(song.id)) continue;
      seen.add(song.id);
      songs.push(song);
      if (songs.length >= limit) break;
    }
  }

  return songs;
}

/**
 * Preserve each shelf's ranking, then alternate the providers represented by
 * those shelves. Without this second pass, six populated shelves all starting
 * with Apple and Deezer fill a 12-track mix before its full-track sources can
 * contribute anything.
 */
export function interleaveSongsByProvider(groups: Array<Song[] | undefined>, limit = Number.POSITIVE_INFINITY): Song[] {
  const providers = new Map<Song['provider'], Song[]>();
  for (const song of interleaveSongGroups(groups)) {
    const providerSongs = providers.get(song.provider);
    if (providerSongs) providerSongs.push(song);
    else providers.set(song.provider, [song]);
  }
  return interleaveSongGroups([...providers.values()], limit);
}

export function playableSongs(songs: Song[]): Song[] {
  return songs.filter((song) => song.playbackUnavailable !== true);
}

/** Apple exposes an official clip; the open providers expose full recordings. */
export function filterSongsByAccess(songs: Song[], mode: AudioAccessMode): Song[] {
  if (mode === 'all') return songs;
  const wantsPreview = mode === 'preview';
  return songs.filter((song) => (isPreviewProvider(song.provider) || isPreviewOnlyEntityId(song.id)) === wantsPreview);
}

export function selectSongsByAccess(
  songs: Song[],
  mode: AudioAccessMode,
  limit = Number.POSITIVE_INFINITY,
): Song[] {
  const filtered = filterSongsByAccess(songs, mode);
  if (!Number.isFinite(limit)) return filtered;
  return filtered.slice(0, Math.max(0, Math.floor(limit)));
}

export function filterEntitiesByAccess<T extends { id: string }>(entities: T[], mode: AudioAccessMode): T[] {
  if (mode === 'all') return entities;
  const wantsPreview = mode === 'preview';
  return entities.filter((entity) => isPreviewOnlyEntityId(entity.id) === wantsPreview);
}

export function uniqueAlbumSongs(songs: Song[], limit = Number.POSITIVE_INFINITY): Song[] {
  const seen = new Set<string>();
  return songs.filter((song) => {
    const albumName = song.album.trim().toLowerCase();
    const genericAlbum =
      albumName === 'unknown' || albumName === 'unknown album' || albumName === 'untitled' || albumName === 'n/a';
    if (!song.albumId || genericAlbum || seen.has(song.albumId) || seen.size >= limit) return false;
    seen.add(song.albumId);
    return true;
  });
}

function signalKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function addSignal(scores: Map<string, number>, value: string, amount: number): void {
  const key = signalKey(value);
  if (!key || amount <= 0) return;
  scores.set(key, (scores.get(key) ?? 0) + amount);
}

/**
 * Builds an on-device discovery mix from the music a listener has actually
 * kept or played. There is no account profile or remote recommendation model:
 * favorites are the strongest signal, recency provides the next one, and the
 * final pass stops one artist or provider from taking over the shelf.
 */
export function buildListeningMix(history: Song[], favorites: Song[], candidates: Song[], limit = 12): Song[] {
  const requestedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 12;
  const seeds = [...favorites, ...history];
  if (seeds.length === 0 || candidates.length === 0) return [];

  const artistScores = new Map<string, number>();
  const genreScores = new Map<string, number>();
  const providerScores = new Map<string, number>();
  const heardIds = new Set(history.map((song) => song.id));

  seeds.forEach((song, index) => {
    const favoriteBonus = index < favorites.length ? 8 : 0;
    const recencyWeight = Math.max(1, seeds.length - index) + favoriteBonus;
    addSignal(artistScores, song.artist, recencyWeight * 6);
    addSignal(genreScores, song.genre, recencyWeight * 3);
    addSignal(providerScores, song.provider, recencyWeight);
  });

  const seen = new Set<string>();
  const ranked = candidates
    .filter((song) => song.playbackUnavailable !== true && !heardIds.has(song.id) && !seen.has(song.id))
    .filter((song) => {
      seen.add(song.id);
      return true;
    })
    .map((song, index) => ({
      song,
      index,
      score:
        (artistScores.get(signalKey(song.artist)) ?? 0) +
        (genreScores.get(signalKey(song.genre)) ?? 0) +
        (providerScores.get(signalKey(song.provider)) ?? 0),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const results: Song[] = [];
  const selected = new Set<string>();
  const artistCounts = new Map<string, number>();
  const providerCounts = new Map<string, number>();
  const add = (song: Song) => {
    const artist = signalKey(song.artist);
    const provider = signalKey(song.provider);
    selected.add(song.id);
    artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
    providerCounts.set(provider, (providerCounts.get(provider) ?? 0) + 1);
    results.push(song);
  };

  for (const { song } of ranked) {
    if (results.length >= requestedLimit) break;
    const artist = signalKey(song.artist);
    const provider = signalKey(song.provider);
    // Let a small mix keep its strongest matches, then diversify the rest so
    // a single album or aggregator never becomes the whole recommendation.
    if (results.length >= 4 && ((artistCounts.get(artist) ?? 0) >= 2 || (providerCounts.get(provider) ?? 0) >= 3)) {
      continue;
    }
    add(song);
  }

  // A very narrow catalog can exhaust the diversity guard. Finish with the
  // remaining ranked tracks rather than returning a needlessly short mix.
  for (const { song } of ranked) {
    if (results.length >= requestedLimit) break;
    if (!selected.has(song.id)) add(song);
  }

  return results;
}

export function buildListeningMixForAccess(
  history: Song[],
  favorites: Song[],
  candidates: Song[],
  mode: AudioAccessMode,
  limit = 12,
): Song[] {
  return buildListeningMix(history, favorites, filterSongsByAccess(candidates, mode), limit);
}
