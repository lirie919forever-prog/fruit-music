import type { Song } from '@/types/music';
import { isPreviewSource, isResolverSource } from '@/lib/sourceRegistry';

export type AudioAccessMode = 'all' | 'full' | 'preview';

export function isPreviewProvider(provider: Song['provider']): boolean {
  return isPreviewSource(provider);
}

export function isPreviewOnlyEntityId(id: string): boolean {
  return id.startsWith('itunes-') || id.startsWith('deezer-');
}

/** Short Kuwo responses are frequently preview-like clips, not full recordings. */
const MIN_RELIABLE_FULL_TRACK_SECONDS = 45;
const ARCHIVE_FILENAME = /\.(wav|ogg|mp3|flac|m4a|aac|opus)$/i;
const NON_MUSIC_TITLE =
  /\b(?:ringtone|notification|alert|alarm|sound effects?|sfx|soundbite|jingle|beep|voice memo|voice message|snippet|teaser|preview clip)\b/i;
const SHORT_FORM_TITLE = /\b(?:interlude|intro|outro|skit|overture|movement|prelude|prologue|epilogue|transition)\b/i;

export function isFullTrack(song: Song): boolean {
  return (
    !isPreviewProvider(song.provider) &&
    !isPreviewOnlyEntityId(song.id) &&
    isCuratableTitle(song) &&
    !isSuspiciousShortTrack(song) &&
    !(isResolverSource(song.provider) && song.duration < MIN_RELIABLE_FULL_TRACK_SECONDS)
  );
}

/**
 * Resolver catalogs can describe a full recording, but their stream still has
 * to be checked when playback starts. Keep those candidates out of the
 * full-track filter so that label only promises direct, full-length sources.
 */
export function isDirectFullTrack(song: Song): boolean {
  // Include resolver sources (Kuwo, LX Music) whose tracks pass the full-track
  // duration check. Excluding them entirely hid mainstream full-track search
  // results behind the CC-only sources: a user searching for a chart artist
  // saw covers and remixes, not the real full track that exists on Kuwo at
  // 320kbps. isFullTrack already enforces a 45-second minimum for resolver
  // tracks, so short preview clips are still excluded.
  return song.isLive !== true && isFullTrack(song);
}

/**
 * A track title ending in '.wav', '.ogg', '.mp3' or '.flac' is a raw filename
 * from a public-domain media archive, not a curated release. These surface in
 * the spotlight from time to time and produce a homepage hero that reads like a
 * file manager. The spotlight and release-rail selections filter them out so
 * the first impression is actual music, not a field recording.
 */
export function isCuratableTitle(song: Song): boolean {
  return !ARCHIVE_FILENAME.test(song.title) && !NON_MUSIC_TITLE.test(song.title);
}

/**
 * A known short recording is not automatically bad: an explicitly named
 * interlude or transition can be a legitimate part of an album. Everything
 * else below this floor is treated as a clip when presented as a full-track
 * source. Unknown durations remain eligible because some open catalogs do not
 * expose metadata even when their stream is complete.
 */
function isSuspiciousShortTrack(song: Song): boolean {
  return (
    song.isLive !== true &&
    song.duration > 0 &&
    song.duration < MIN_RELIABLE_FULL_TRACK_SECONDS &&
    !SHORT_FORM_TITLE.test(song.title)
  );
}

/** Filter catalog noise before access-mode ranking and source deduplication. */
export function isSearchableSong(song: Song): boolean {
  if (song.isLive === true) return true;
  if (!isCuratableTitle(song)) return false;
  if (isPreviewProvider(song.provider) || isPreviewOnlyEntityId(song.id)) return true;
  return !isSuspiciousShortTrack(song);
}

function isPreviewTrack(song: Song): boolean {
  return isPreviewProvider(song.provider) || isPreviewOnlyEntityId(song.id);
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

function recordingKey(song: Song): string {
  const artist = signalKey(song.artist);
  const title = signalKey(song.title);
  return artist && title ? `recording:${artist}:${title}` : `id:${song.id}`;
}

/**
 * Builds a queue for a track station. The selected track stays first, while
 * the rest comes from verified full-track providers and is interleaved by
 * provider so one catalog cannot consume the whole station.
 */
export function buildStationQueue(seed: Song, candidates: Song[], limit = 12): Song[] {
  const requestedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 12;
  const results: Song[] = [];
  const seenIds = new Set<string>();
  const seenRecordings = new Set<string>();

  const add = (song: Song, allowPreview: boolean): void => {
    if (results.length >= requestedLimit || song.playbackUnavailable === true || song.isLive === true) return;
    if (!allowPreview && !isFullTrack(song)) return;
    const key = recordingKey(song);
    if (seenIds.has(song.id) || seenRecordings.has(key)) return;
    seenIds.add(song.id);
    seenRecordings.add(key);
    results.push(song);
  };

  // Preview catalog entries can still resolve to a full recording at playback
  // time, so the listener's selected song is allowed to remain the seed.
  add(seed, true);

  const providerGroups = new Map<Song['provider'], Song[]>();
  for (const candidate of candidates) {
    if (candidate.playbackUnavailable === true || candidate.isLive === true || !isFullTrack(candidate)) continue;
    const group = providerGroups.get(candidate.provider);
    if (group) group.push(candidate);
    else providerGroups.set(candidate.provider, [candidate]);
  }

  for (const candidate of interleaveSongGroups([...providerGroups.values()])) {
    add(candidate, false);
    if (results.length >= requestedLimit) break;
  }

  return results;
}

/** Apple exposes an official clip; the open providers expose full recordings. */
export function filterSongsByAccess(songs: Song[], mode: AudioAccessMode): Song[] {
  const searchable = songs.filter(isSearchableSong);
  if (mode === 'all') return searchable;
  return mode === 'full' ? searchable.filter(isDirectFullTrack) : searchable.filter(isPreviewTrack);
}

export function selectSongsByAccess(songs: Song[], mode: AudioAccessMode, limit = Number.POSITIVE_INFINITY): Song[] {
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
    .filter(
      (song) =>
        song.playbackUnavailable !== true && song.isLive !== true && !heardIds.has(song.id) && !seen.has(song.id),
    )
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

/**
 * Returns a useful mix even for a brand-new listener. Once history or
 * favourites exist, the stronger on-device ranking remains the first choice;
 * otherwise full-track candidates are preferred and provider diversity keeps
 * the first listen from looking like one source's dump.
 */
export function buildDiscoveryMixForAccess(
  history: Song[],
  favorites: Song[],
  candidates: Song[],
  mode: AudioAccessMode,
  limit = 12,
): Song[] {
  const personalized = buildListeningMixForAccess(history, favorites, candidates, mode, limit);
  if (personalized.length > 0) return personalized;

  const available = filterSongsByAccess(candidates, mode).filter(
    (song) => song.playbackUnavailable !== true && song.isLive !== true,
  );
  const fullTracks = interleaveSongsByProvider([available.filter(isFullTrack)], limit);
  if (fullTracks.length >= limit) return fullTracks;
  const previews = interleaveSongsByProvider(
    [available.filter((song) => !isFullTrack(song))],
    limit - fullTracks.length,
  );
  return uniqueSongs([...fullTracks, ...previews]).slice(0, limit);
}
