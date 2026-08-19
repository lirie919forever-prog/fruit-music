import type { Album, Artist, MusicProviderName, Song } from '@/types/music';
import { filterSongsByAccess, isDirectFullTrack, isSearchableSong, type AudioAccessMode } from './newViewModel';
import { isPreviewSource, isResolverSource } from '@/lib/sourceRegistry';

const PROVIDER_RELEVANCE: Record<MusicProviderName, number> = {
  // Official previews are the strongest mainstream identity signal in All
  // audio mode. They remain visibly labeled as previews and never become
  // full-track results through this score.
  'Apple Preview': 90,
  'Deezer Preview': 85,
  Jamendo: 42,
  'Wikimedia Commons': 39,
  Archive: 32,
  ccMixter: 35,
  Openverse: 32,
  Audius: 24,
  'LX Music': 16,
  // Resolver matches are still probed before playback, but an exact
  // mainstream identity is more useful than an open upload that merely has
  // verified metadata.
  Kuwo: 58,
  'QQ Music': 72,
  Bilibili: 70,
  Invidious: 70,
  Netease: 74,
  Kugou: 73,
  SomaFM: 12,
  'NTS Radio': 14,
  'Radio Paradise': 16,
  KEXP: 15,
  FIP: 15,
  'The Current': 15,
  'Radio France': 15,
  'Asia Dream Radio': 16,
  'Japan Music Radio': 16,
  'Radio Browser': 10,
  'Local file': 100,
};

const LOW_SIGNAL_TITLE =
  /\b(official (audio|video)|lyrics?|extended|nightcore|slowed|reverb|type beat|karaoke)\b|\[[a-z0-9_-]{8,}\]/i;
const NON_STUDIO_TITLE =
  /\b(remix|live|cover|instrumental|karaoke|acoustic|sped up|slowed|preview|version|ver\.?|edit|movie|interlude|intro|outro|skit|overture|rehearsal|festival|concert|tour|stage|first take|interview|podcast|episode|ep\s*\d+|orchestral|orchestra|music box|a cappella|acapella|piano (?:cover|version)|instrumental version)\b|(?:\u73b0\u573a|\u73fe\u5834|\u7ffb\u5531|\u7ffb\u81ea|\u7ffb\u594f|\u7ffb\u5531\u7248|\u7ffb\u594f\u7248|\u8bd5\u542c|\u8a66\u8074|\u4f34\u594f|\u5267\u573a\u7248|\u5287\u5834\u7248|\u76f4\u64ad|\u7247\u6bb5|\u97f3\u4e50\u8282|\u97f3\u6a02\u7bc0|\u97f3\u4e50\u4f1a|\u97f3\u6a02\u6703|\u94a2\u7434|\u92fc\u7434|\u7ba1\u5f26|\u4ea4\u54cd|\u7eaf\u97f3\u4e50|\u7d14\u97f3\u6a02|\u6f14\u594f)/iu;
const LOCALIZED_ALT_TITLE = /\([^)]*[\u3400-\u9fff][^)]*\)/u;
const SHORT_FORM_TITLE = /\b(interlude|intro|outro|skit|overture|rehearsal)\b/i;
const TRAILING_UPLOAD_ID = /\s*\[[a-z0-9_-]{8,}\]\s*$/i;

function isArtistIntent(exactArtistMatches: number, query: string): boolean {
  return exactArtistMatches >= 2 && query.split(' ').filter(Boolean).length <= 3;
}

function matchesArtistIdentity(artist: string, query: string): boolean {
  return artist === query || artist.startsWith(`${query} `);
}

function isMainstreamPreview(song: Song): boolean {
  return song.provider === 'Apple Preview' || song.provider === 'Deezer Preview';
}

const ENTITY_PROVIDER_RELEVANCE: Record<string, number> = {
  itunes: 90,
  deezer: 85,
  kuwo: 78,
  bilibili: 74,
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

/**
 * A common Japanese search combines a romanized artist and a native-language
 * title, for example "YOASOBI 夜に駆ける". Neither field equals the combined
 * query, so ordinary phrase matching let covers with the same title outrank
 * the original. Reward a query that independently matches both fields.
 */
function combinedArtistTitleScore(title: string, artist: string, query: string): number {
  const titleMatches = title.length > 1 && query.includes(title);
  const artistMatches = artist.length > 1 && query.includes(artist);
  return titleMatches && artistMatches ? 1_060 : 0;
}

function exactArtistMatchCount(songs: readonly Song[], query: string): number {
  return songs.reduce((count, song) => count + (normalize(song.artist) === query ? 1 : 0), 0);
}

interface SearchIdentityEvidence {
  providers: Set<MusicProviderName>;
  verifiedProviders: Set<MusicProviderName>;
}

interface TitleArtistSignal {
  artist: string;
  providers: Set<MusicProviderName>;
  firstIndex: number;
}

function buildIdentityEvidence(songs: readonly Song[]): Map<string, SearchIdentityEvidence> {
  const evidence = new Map<string, SearchIdentityEvidence>();
  for (const song of songs) {
    if (!isSearchableSong(song)) continue;
    const key = identity(song);
    const existing = evidence.get(key) ?? { providers: new Set(), verifiedProviders: new Set() };
    existing.providers.add(song.provider);
    if (song.metadataVerified) existing.verifiedProviders.add(song.provider);
    evidence.set(key, existing);
  }
  return evidence;
}

function corroborationScore(song: Song, evidence: Map<string, SearchIdentityEvidence>): number {
  const identityEvidence = evidence.get(identity(song));
  if (!identityEvidence || identityEvidence.providers.size < 2) return 0;

  // A same-title result from one provider can be an upload or an alternate
  // recording. Independent provider agreement is useful evidence, especially
  // when the agreeing records are metadata-verified previews that full-track
  // filtering would otherwise remove before ranking.
  const providerBonus = (identityEvidence.providers.size - 1) * 54;
  const verifiedBonus = Math.min(2, identityEvidence.verifiedProviders.size) * 12;
  return providerBonus + verifiedBonus;
}

/**
 * Preview catalogs are the only federated sources that consistently expose a
 * mainstream recording identity. Preserve that signal when full-track mode
 * removes the previews themselves: an exact-title cover should not outrank a
 * creator upload that explicitly names the known artist in its title.
 */
function buildTitleArtistEvidence(songs: readonly Song[]): Map<string, TitleArtistSignal[]> {
  const evidence = new Map<string, Map<string, TitleArtistSignal>>();
  songs.forEach((song, index) => {
    if (!isSearchableSong(song) || !isPreviewSource(song.provider)) return;
    const title = normalize(song.title);
    const artist = normalize(song.artist);
    if (!title || !artist) return;

    const artists = evidence.get(title) ?? new Map<string, TitleArtistSignal>();
    const existing = artists.get(artist);
    if (existing) existing.providers.add(song.provider);
    else artists.set(artist, { artist, providers: new Set([song.provider]), firstIndex: index });
    evidence.set(title, artists);
  });

  return new Map(
    [...evidence.entries()].map(([title, artists]) => [
      title,
      [...artists.values()].sort(
        (left, right) => right.providers.size - left.providers.size || left.firstIndex - right.firstIndex,
      ),
    ]),
  );
}

function titleArtistScore(song: Song, query: string, evidence: Map<string, TitleArtistSignal[]>): number {
  const signals = evidence.get(query);
  if (!signals?.length) return 0;

  const trustedSignals = signals.slice(0, 3);
  const candidateArtist = normalize(song.artist);
  const candidateTitle = normalize(song.title);
  const artistMatch = trustedSignals.find((signal) => signal.artist === candidateArtist);
  if (artistMatch) return 320 + artistMatch.providers.size * 60;

  if (trustedSignals.some((signal) => candidateTitle.includes(signal.artist))) return 220;

  // An exact title with a different artist is usually a cover/alternate in a
  // resolver catalog. Keep it discoverable, but place it below an identity
  // that has explicit mainstream corroboration.
  if (candidateTitle === query && !isPreviewSource(song.provider)) return -320;
  return 0;
}

function score(
  song: Song,
  query: string,
  evidence: Map<string, SearchIdentityEvidence>,
  titleArtistEvidence: Map<string, TitleArtistSignal[]>,
  exactArtistMatches: number,
  hasOfficialArtistEvidence: boolean,
  accessMode?: AudioAccessMode,
): number {
  const title = normalize(song.title);
  const artist = normalize(song.artist);
  const artistIntent = isArtistIntent(exactArtistMatches, query);
  const artistIdentityMatch = matchesArtistIdentity(artist, query);
  const relevance =
    combinedArtistTitleScore(title, artist, query) +
    // An exact title is the strongest signal for a track search. Keep an
    // exact artist match close behind so a song named after the artist still
    // loses to the actual artist record when provider quality differs.
    phraseScore(artist, query, 680, 500, 310) +
    phraseScore(title, query, 850, 430, 250) +
    // A one-word artist query often appears at the start of noisy upload
    // titles. Give an exact artist identity enough weight to beat those title
    // prefixes while keeping an exact song title the strongest song signal.
    // Repeated exact artist identities are strong evidence that this is an
    // artist search. Keep those records above an unrelated track whose title
    // merely happens to equal the artist name.
    (artistIdentityMatch ? (artist === query ? (exactArtistMatches >= 2 ? 300 : 160) : 220) : 0) +
    // Resolver catalogs commonly return a track named after the artist before
    // the artist's actual recordings. Prefer the exact artist record when both
    // candidates come from the same mainstream resolver.
    (isResolverSource(song.provider) && artist === query ? 40 : 0) +
    tokenScore(artist, query) +
    tokenScore(title, query) +
    titleArtistScore(song, query, titleArtistEvidence) +
    // Once several records prove the query is an artist identity, an exact
    // title collision from another artist is a much weaker interpretation of
    // the search than any of those recordings.
    (exactArtistMatches >= 2 && title === query && artist !== query ? -420 : 0);
  const quality =
    PROVIDER_RELEVANCE[song.provider] +
    (song.metadataVerified ? 12 : -10) +
    (song.duration > 0 ? 4 : 0) +
    (song.isLive ? -28 : 0) +
    (song.playbackUnavailable ? -500 : 0) +
    (LOW_SIGNAL_TITLE.test(song.title) ? -36 : 0) +
    // Keep alternates discoverable in More tracks, but stop live/festival,
    // interlude, cover, and translated-uploader variants from taking over the
    // compact top shelf when a clean identity is available.
    (NON_STUDIO_TITLE.test(song.title) ? (accessMode === 'full' ? -280 : -180) : 0) +
    (SHORT_FORM_TITLE.test(song.title) && accessMode === 'full' ? -130 : 0) +
    (LOCALIZED_ALT_TITLE.test(song.title) ? (accessMode === 'full' ? -280 : -70) : 0) +
    (artist === query && title !== query && title.includes(query) ? -140 : 0) +
    (hasOfficialArtistEvidence && artist === query && !isMainstreamPreview(song) && !isResolverSource(song.provider)
      ? -220
      : 0) +
    // Full-track searches need a mainstream identity lane. Open archives can
    // contain a correctly tagged artist upload, but a verified resolver record
    // is the better first play target for a mainstream artist query.
    (accessMode === 'full' && artistIntent && artistIdentityMatch && isResolverSource(song.provider)
      ? NON_STUDIO_TITLE.test(song.title) || LOCALIZED_ALT_TITLE.test(song.title)
        ? 260
        : 460
      : 0) +
    corroborationScore(song, evidence);

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
function rankSearchSongsInternal(
  songs: Song[],
  query: string,
  preferFullDuplicates: boolean,
  accessMode?: AudioAccessMode,
): Song[] {
  const normalizedQuery = normalize(query);
  const evidence = buildIdentityEvidence(songs);
  const titleArtistEvidence = buildTitleArtistEvidence(songs);
  const exactArtistMatches = exactArtistMatchCount(songs, normalizedQuery);
  const searchableSongs = accessMode ? filterSongsByAccess(songs, accessMode) : songs.filter(isSearchableSong);
  const mainstreamArtistSongs = searchableSongs.filter(
    (song) => isMainstreamPreview(song) && normalize(song.artist) === normalizedQuery,
  );
  const hasOfficialArtistEvidence =
    accessMode !== 'full' &&
    songs.some((song) => isMainstreamPreview(song) && normalize(song.artist) === normalizedQuery);
  const rankedByScore = searchableSongs
    .map((song, index) => ({
      song,
      index,
      score: score(
        song,
        normalizedQuery,
        evidence,
        titleArtistEvidence,
        exactArtistMatches,
        hasOfficialArtistEvidence,
        accessMode,
      ),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const ranked =
    accessMode === 'all' && mainstreamArtistSongs.length >= 3
      ? [
          ...rankedByScore.filter(
            ({ song }) => isMainstreamPreview(song) && normalize(song.artist) === normalizedQuery,
          ),
          ...rankedByScore.filter(
            ({ song }) => !(isMainstreamPreview(song) && normalize(song.artist) === normalizedQuery),
          ),
        ].map((candidate, rank) => ({ ...candidate, rank }))
      : rankedByScore.map((candidate, rank) => ({ ...candidate, rank }));
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
  return rankSearchSongsInternal(songs, query, mode === 'all', mode);
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
  // Artist searches can return a large block of official previews alongside
  // open uploads and resolver alternates. Keep that mainstream identity lane
  // visible at the top when it has enough depth, while preserving every other
  // result below it for users who want full-length or alternate recordings.
  const officialPreviewLane = songs.filter(isMainstreamPreview);
  const orderedSongs =
    officialPreviewLane.length >= 3
      ? [...officialPreviewLane, ...songs.filter((song) => !isMainstreamPreview(song))]
      : songs;
  return {
    topMatches: orderedSongs.slice(0, cappedLimit),
    remainingTracks: orderedSongs.slice(cappedLimit),
  };
}
