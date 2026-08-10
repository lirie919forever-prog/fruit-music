/**
 * LRC parsing, and the lookup that turns a playback position into a line.
 *
 * Kept separate from anything that fetches or renders because this is the part
 * with edge cases worth pinning down: a real LRC file is hand-authored, and the
 * ones LRCLIB serves carry every quirk twenty-five years of the format
 * accumulated — repeated timestamps on one line, word-level tags inside it,
 * metadata that looks exactly like a timestamp, and lines out of order.
 */

export interface LyricLine {
  /** Seconds from the start of the recording. */
  time: number;
  text: string;
}

/**
 * `[mm:ss]`, `[mm:ss.xx]` or `[mm:ss.xxx]`, anchored so it only matches at the
 * point the scanner has reached. Minutes are unbounded: a DJ set runs past 99.
 */
const TIMESTAMP = /^\[(\d{1,4}):([0-5]\d)(?:[.:](\d{1,3}))?\]/;
/** `[ar:Artist]`, `[offset:+500]` — a tag key is letters, never digits. */
const METADATA = /^\[([a-z]+):(.*?)\]/i;
/** Enhanced-LRC word timings, e.g. `<00:12.00>`, which are not line starts. */
const WORD_TIMESTAMP = /<\d{1,4}:[0-5]\d(?:[.:]\d{1,3})?>/g;

function fractionSeconds(raw: string | undefined): number {
  if (!raw) return 0;
  // ".5" is five tenths and ".05" is five hundredths, so the digit count is
  // the scale. Parsing as an integer and dividing by a fixed 1000 would read
  // a two-digit centisecond field — by far the most common form — as
  // milliseconds and put every line 90% closer to the start than it belongs.
  return Number(raw) / 10 ** raw.length;
}

/**
 * The `[offset:…]` tag, in seconds, positive meaning the lyrics should appear
 * earlier.
 *
 * The tag is milliseconds and the sign convention is the one every player
 * inherited from the original Windows tools: a positive offset shifts the
 * lyrics *earlier*, so it is subtracted from each timestamp.
 */
function parseOffsetSeconds(value: string): number {
  const milliseconds = Number(value.trim());
  return Number.isFinite(milliseconds) ? milliseconds / 1_000 : 0;
}

/**
 * Parses an LRC document into time-ordered lines.
 *
 * Lines with no timestamp are dropped rather than guessed at: an LRC file's
 * leading block is metadata, and a plain-text line in the middle of one has no
 * position to be shown at. Lines whose text is empty are kept — that is how the
 * format marks an instrumental gap, and the panel needs it to know that the
 * silence is intentional rather than a line it failed to parse.
 */
export function parseLrc(source: string): LyricLine[] {
  if (typeof source !== 'string' || source.trim() === '') return [];

  const lines: LyricLine[] = [];
  let offsetSeconds = 0;

  for (const rawLine of source.split(/\r?\n/)) {
    let rest = rawLine.trim();
    const times: number[] = [];

    // One line may carry several timestamps: `[00:12.00][01:20.00] chorus`.
    for (;;) {
      const stamp = TIMESTAMP.exec(rest);
      if (stamp) {
        times.push(Number(stamp[1]) * 60 + Number(stamp[2]) + fractionSeconds(stamp[3]));
        rest = rest.slice(stamp[0].length);
        continue;
      }
      // Metadata is only recognised before any timestamp on the line. After
      // one, `[…]` is part of the lyric — bracketed backing vocals are common.
      const meta = times.length === 0 ? METADATA.exec(rest) : null;
      if (meta) {
        if (meta[1].toLowerCase() === 'offset') offsetSeconds = parseOffsetSeconds(meta[2]);
        rest = rest.slice(meta[0].length).trimStart();
        continue;
      }
      break;
    }

    if (times.length === 0) continue;
    const text = rest.replace(WORD_TIMESTAMP, '').trim();
    for (const time of times) lines.push({ time, text });
  }

  return lines
    .map((line) => ({ ...line, time: Math.max(0, line.time - offsetSeconds) }))
    .sort((left, right) => left.time - right.time);
}

/**
 * The index of the line that should be highlighted at `time`, or `-1` before
 * the first one.
 *
 * Binary search rather than a scan: this is called from a rAF-driven progress
 * update, several hundred times a track, against lists that run past a thousand
 * lines for a long recording.
 */
export function activeLyricIndex(lines: LyricLine[], time: number): number {
  if (lines.length === 0 || !Number.isFinite(time) || time < lines[0].time) return -1;

  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (lines[middle].time <= time) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/**
 * Whether a document is worth showing as *synced* lyrics.
 *
 * A file with a single timestamp at `[00:00.00]` parses cleanly but scrolls
 * nowhere, and presenting it as synced is a worse answer than presenting the
 * same words as plain text.
 */
export function isUsableSync(lines: LyricLine[]): boolean {
  return lines.length >= 2 && lines.some((line) => line.time > 0 && line.text !== '');
}

/** Slack for a document whose last line is timed a moment past the fade. */
const SYNC_FIT_TOLERANCE_SECONDS = 5;

/**
 * Whether a timed document describes the audio that is actually playing.
 *
 * Lyrics are written against a full commercial recording. Most of the charts
 * here play as thirty-second previews, which are a clip from the middle of that
 * recording — so the words exist, and every timestamp in them is measured from
 * a zero that is not this clip's zero. Scrolling them anyway highlights the
 * wrong line the entire time and makes clicking one seek somewhere unrelated,
 * which is how this was found: clicking "Your skin makes me cry" landed two
 * lines earlier, because the seek was clamped to the preview's length.
 *
 * A document that runs past the end of what is playing therefore cannot be
 * synced to it, and is shown as plain text instead.
 */
export function syncFitsTrack(lines: LyricLine[], trackDuration: number): boolean {
  if (lines.length === 0 || !Number.isFinite(trackDuration) || trackDuration <= 0) return false;
  return lines[lines.length - 1].time <= trackDuration + SYNC_FIT_TOLERANCE_SECONDS;
}
