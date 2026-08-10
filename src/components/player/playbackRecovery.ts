import type { PlayerState } from '@/store/playerStore';

export const END_TOLERANCE_SECONDS = 2;
const MIN_FULL_TRACK_DECODE_SECONDS = 45;
const MAX_DURATION_DRIFT_SECONDS = 15;
const MAX_DURATION_DRIFT_RATIO = 0.2;

/**
 * A provider can return a successful media response that is only a short clip.
 * Keep a little room for metadata drift, but reject a clearly truncated decode
 * before the player presents it as a full recording.
 */
export function isMateriallyShortStream(
  decodedDuration: number,
  expectedDuration: number,
  requireFullLength = false,
): boolean {
  if (!Number.isFinite(decodedDuration) || decodedDuration <= 0) {
    return false;
  }

  // Resolver catalogs can report the preview length as their only duration.
  // When the caller expects a resolver to provide a full recording, matching
  // 30-second metadata must not make a 30-second clip look trustworthy.
  if (requireFullLength && decodedDuration < MIN_FULL_TRACK_DECODE_SECONDS) {
    return true;
  }

  // Resolver catalogs are not trustworthy when they omit duration. A short
  // successful response is still a preview, even though there is no catalog
  // value to compare it with.
  if (!Number.isFinite(expectedDuration) || expectedDuration <= 0) {
    return decodedDuration < MIN_FULL_TRACK_DECODE_SECONDS;
  }

  return (
    expectedDuration > MIN_FULL_TRACK_DECODE_SECONDS &&
    decodedDuration < MIN_FULL_TRACK_DECODE_SECONDS &&
    expectedDuration - decodedDuration > Math.max(5, expectedDuration * 0.08)
  );
}

/**
 * A resolver can also return a completely different long recording for a
 * matching title. That is not a usable fallback either, even though it is not
 * a short preview. Keep enough tolerance for provider metadata drift while
 * rejecting obvious radio shows, compilations, and podcasts.
 */
export function isMateriallyLongStream(decodedDuration: number, expectedDuration: number): boolean {
  if (
    !Number.isFinite(decodedDuration) ||
    decodedDuration <= 0 ||
    !Number.isFinite(expectedDuration) ||
    expectedDuration <= 0
  ) {
    return false;
  }

  return (
    decodedDuration - expectedDuration >
    Math.max(MAX_DURATION_DRIFT_SECONDS, expectedDuration * MAX_DURATION_DRIFT_RATIO)
  );
}

export function hasNextInQueue(state: Pick<PlayerState, 'queue' | 'queueIndex' | 'shuffle' | 'repeat'>): boolean {
  const { queue, queueIndex, shuffle, repeat } = state;
  if (queueIndex === null || queue.length === 0) return false;
  return (shuffle && queue.length > 1) || queueIndex < queue.length - 1 || repeat === 'all';
}

export function isNaturalTrackEnd(position: number, decodedDuration: number, expectedDuration = 0): boolean {
  if (!Number.isFinite(position) || !Number.isFinite(decodedDuration) || decodedDuration <= 0) return false;

  // A materially shorter decoded duration is usually the signature of a
  // truncated response. Never use that short duration as proof of completion.
  if (Number.isFinite(expectedDuration) && expectedDuration > 0) {
    const durationDelta = expectedDuration - decodedDuration;
    if (durationDelta > Math.max(END_TOLERANCE_SECONDS, expectedDuration * 0.05)) return false;
  }

  return position >= Math.max(0, decodedDuration - END_TOLERANCE_SECONDS);
}

export function getResumePosition(position: number, duration: number): number {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(position, Math.max(0, duration - 0.25)));
}

/**
 * The one answer to "how long is this track", used by both the progress bar and
 * the scrubber.
 *
 * Some browsers cannot report a duration while the first response is a 206
 * range, so `onload` fell back to the verified catalog length — but `seek`
 * consulted only the decoded value and returned early when it was unusable.
 * The bar therefore showed a draggable track of a known length and dragging it
 * did nothing at all, with no way to tell that had happened. Both now read this.
 */
export function effectiveDuration(decodedDuration: number | undefined, catalogDuration: number): number {
  if (typeof decodedDuration === 'number' && Number.isFinite(decodedDuration) && decodedDuration > 0) {
    return decodedDuration;
  }
  return Number.isFinite(catalogDuration) && catalogDuration > 0 ? catalogDuration : 0;
}
