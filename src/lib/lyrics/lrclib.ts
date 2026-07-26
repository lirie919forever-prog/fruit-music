import { isUsableSync, parseLrc, type LyricLine } from './lrc';

/**
 * Choosing which LRCLIB record is the song that is playing.
 *
 * LRCLIB's search returns up to twenty records for a popular title, most of
 * them the same recording filed under a different compilation. Taking the first
 * one is how a lyrics panel ends up showing a karaoke version, a live cut, or a
 * different song that happens to share a name — so the choice is made here,
 * where it can be tested, rather than inside a fetch.
 *
 * `/api/get` is not used. It matches on duration within a couple of seconds,
 * and the largest catalog in this app is Apple's, whose tracks are honestly
 * thirty seconds long because that is all a preview is. Every one of them would
 * miss. Search plus an explicit choice covers both that case and a full-length
 * Creative Commons recording, in one upstream call.
 */

/** A record as LRCLIB's `/api/search` returns it. */
export interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number | null;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface LyricsQuery {
  track: string;
  artist: string;
  album?: string;
  /** Seconds. Ignored below `MATCHABLE_DURATION_SECONDS`. */
  duration?: number;
}

export interface LyricsResult {
  provider: 'LRCLIB';
  /** The record this came from, so the UI can link to what it is showing. */
  sourceUrl: string;
  trackName: string;
  artistName: string;
  instrumental: boolean;
  /** Empty when the record has no usable synced document. */
  synced: LyricLine[];
  /** Empty when the record has no plain text. */
  plain: string;
}

/**
 * Below this, a duration describes a clip rather than a recording, and
 * comparing it against a catalog of full-length songs would reject every
 * correct answer. Apple previews are exactly thirty seconds.
 */
export const MATCHABLE_DURATION_SECONDS = 45;
/** How far a candidate may sit from a trusted duration and still be the song. */
const DURATION_TOLERANCE_SECONDS = 12;

/**
 * Parenthetical and dash-suffixed qualifiers: `(feat. X)`, `[Remastered]`,
 * `- Radio Edit`. Two recordings of one song differ by exactly this much, so
 * the qualifier cannot be part of the identity — but it is worth a tiebreak,
 * which is why it is stripped rather than rejected.
 */
const QUALIFIER = /\s*(?:[([][^)\]]*[)\]]|-\s+[^-]*)\s*$/;
const FEATURING = /\s+(?:feat\.?|ft\.?|featuring|with)\s+.*$/i;
const PUNCTUATION = /[^\p{L}\p{N}\s]/gu;
/**
 * Apostrophes close up rather than separate. Every other mark becomes a space,
 * but doing that to "Don't" yields "don t", which no longer matches the catalog
 * that spelled it "Dont" — and catalogs disagree about the apostrophe
 * constantly, including about which of the four characters below they used.
 */
const APOSTROPHE = /['’‘`´]/g;

function normalize(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      // Combining marks, so "Beyoncé" and "Beyonce" are the same artist.
      .replace(/\p{M}/gu, '')
      .replace(APOSTROPHE, '')
      .replace(PUNCTUATION, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** A title with its qualifier and featured artists removed. */
export function normalizeTitle(value: string): string {
  return normalize(value.replace(FEATURING, '').replace(QUALIFIER, ''));
}

/**
 * The billed lead artist. Collaborations are written half a dozen ways — `A &
 * B`, `A / B`, `A, B`, `A feat. B` — and LRCLIB rarely spells one the same way
 * the catalog does, so only the first name is compared.
 */
export function normalizeArtist(value: string): string {
  return normalize(value.replace(FEATURING, '').split(/[/&,;×]|\bx\b/i)[0] ?? '');
}

function trustworthy(duration: number | undefined): duration is number {
  return typeof duration === 'number' && Number.isFinite(duration) && duration >= MATCHABLE_DURATION_SECONDS;
}

export function isLrclibRecord(value: unknown): value is LrclibRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'number' &&
    typeof record.trackName === 'string' &&
    typeof record.artistName === 'string' &&
    // A record with neither kind of lyric is a stub row and cannot be shown.
    (typeof record.plainLyrics === 'string' || typeof record.syncedLyrics === 'string' || record.instrumental === true)
  );
}

/**
 * How well a record answers the query, or `null` if it is not the same song.
 *
 * Title and lead artist both have to match; nothing else can rescue a record
 * that fails either, because the failure mode being avoided is confidently
 * showing the wrong words. Everything after that is preference.
 */
export function scoreRecord(record: LrclibRecord, query: LyricsQuery): number | null {
  if (normalizeTitle(record.trackName) !== normalizeTitle(query.track)) return null;

  const wanted = normalizeArtist(query.artist);
  const got = normalizeArtist(record.artistName);
  if (wanted === '' || got === '') return null;
  // Containment either way: catalogs disagree about whether the band is "The
  // Beatles" or "Beatles", and about how much of a long name is billed.
  if (got !== wanted && !got.includes(wanted) && !wanted.includes(got)) return null;

  let score = 0;
  if (typeof record.syncedLyrics === 'string' && isUsableSync(parseLrc(record.syncedLyrics))) score += 100;
  else if (typeof record.plainLyrics === 'string' && record.plainLyrics.trim() !== '') score += 20;
  else if (!record.instrumental) return null;

  if (trustworthy(query.duration) && typeof record.duration === 'number') {
    const gap = Math.abs(record.duration - query.duration);
    if (gap > DURATION_TOLERANCE_SECONDS) return null;
    // A closer duration is a better answer, but never enough on its own to
    // beat a record that actually carries a synced document.
    score += Math.round(30 - (gap / DURATION_TOLERANCE_SECONDS) * 30);
  }

  if (got === wanted) score += 10;
  if (query.album && record.albumName && normalizeTitle(record.albumName) === normalizeTitle(query.album)) score += 15;
  // Prefer the record whose title needed no trimming to match, so
  // "Song (Live)" loses to "Song" when the query asked for "Song".
  if (normalize(record.trackName) === normalize(query.track)) score += 5;

  return score;
}

/**
 * The best record for the query, or `null` when none of them is the song.
 *
 * Ties break towards the lower id, which is the record LRCLIB has held longest
 * and so the one most likely to have been corrected.
 */
export function pickLyricsMatch(records: unknown, query: LyricsQuery): LrclibRecord | null {
  if (!Array.isArray(records)) return null;

  let best: LrclibRecord | null = null;
  let bestScore = -1;
  for (const candidate of records) {
    if (!isLrclibRecord(candidate)) continue;
    const score = scoreRecord(candidate, query);
    if (score === null) continue;
    if (score > bestScore || (score === bestScore && best !== null && candidate.id < best.id)) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The shape check the client runs on the route's answer.
 *
 * The server validated the record it chose, but what reaches the panel is a
 * JSON body over the network, and that is the same untrusted input every other
 * data path in this app checks before rendering — see `isSong`.
 */
export function isLyricsResult(value: unknown): value is LyricsResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    result.provider === 'LRCLIB' &&
    typeof result.sourceUrl === 'string' &&
    typeof result.trackName === 'string' &&
    typeof result.artistName === 'string' &&
    typeof result.instrumental === 'boolean' &&
    typeof result.plain === 'string' &&
    Array.isArray(result.synced) &&
    result.synced.every(
      (line) =>
        typeof line === 'object' &&
        line !== null &&
        typeof (line as LyricLine).time === 'number' &&
        Number.isFinite((line as LyricLine).time) &&
        typeof (line as LyricLine).text === 'string',
    )
  );
}

export function toLyricsResult(record: LrclibRecord): LyricsResult {
  const synced = typeof record.syncedLyrics === 'string' ? parseLrc(record.syncedLyrics) : [];
  return {
    provider: 'LRCLIB',
    sourceUrl: `https://lrclib.net/api/get/${record.id}`,
    trackName: record.trackName,
    artistName: record.artistName,
    instrumental: record.instrumental === true,
    synced: isUsableSync(synced) ? synced : [],
    plain: typeof record.plainLyrics === 'string' ? record.plainLyrics.trim() : '',
  };
}
