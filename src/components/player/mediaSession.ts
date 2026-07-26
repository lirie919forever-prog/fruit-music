import type { Song } from '@/types/music';

/**
 * The two decisions in the Media Session wiring that are worth testing on their
 * own: what artwork to declare, and whether the current numbers can legally be
 * reported as a playback position.
 *
 * `setPositionState` is one of the few DOM calls that throws on bad input
 * rather than ignoring it — a position past the duration, a duration of `NaN`
 * or a rate of zero all raise a `TypeError` — and it is called from a place
 * where a throw would take the audio engine's effect down with it.
 */

/**
 * The artwork entry for the lock screen and the OS media popup.
 *
 * `sizes: 'any'` rather than a number: by the time a cover reaches here it is
 * a URL string from one of four catalogs, and its real dimensions are not
 * knowable from it. The previous wiring declared every cover `512x512`, which
 * was wrong for all of them — Apple's are 600 square and the fallback is an
 * SVG — and a platform that trusts the declaration to pick between candidates
 * was being told something false. `any` is the honest answer for a single
 * scalable-or-unknown source, and it is what every platform falls back to.
 */
export function mediaArtwork(coverArt: string): MediaImage[] {
  if (!coverArt) return [];
  const svg = coverArt.startsWith('data:image/svg+xml') || coverArt.endsWith('.svg');
  return [{ src: coverArt, sizes: 'any', ...(svg ? { type: 'image/svg+xml' } : {}) }];
}

export function mediaMetadataInit(song: Song): MediaMetadataInit {
  return {
    title: song.title,
    artist: song.artist,
    // A single's album is often just the track title again; repeating it in the
    // OS popup wastes the only other line there is.
    album: song.album && song.album !== song.title ? song.album : '',
    artwork: mediaArtwork(song.coverArt),
  };
}

/**
 * The position to report, or `null` when there is nothing reportable.
 *
 * Returning `null` instead of clamping silently would hide a real bug; the
 * clamping that does happen is only for the one case that legitimately occurs,
 * a progress value a fraction past the end while the `ended` event is in
 * flight.
 */
export function positionState(duration: number, position: number, playbackRate = 1): MediaPositionState | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (!Number.isFinite(playbackRate) || playbackRate <= 0) return null;
  if (!Number.isFinite(position)) return null;
  return { duration, position: Math.max(0, Math.min(duration, position)), playbackRate };
}

/** How far the OS's skip buttons move when the platform names no offset. */
export const DEFAULT_SEEK_OFFSET_SECONDS = 10;
