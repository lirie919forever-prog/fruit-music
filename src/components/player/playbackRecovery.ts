import type { PlayerState } from '@/store/playerStore';

export const END_TOLERANCE_SECONDS = 2;

export function hasNextInQueue(state: Pick<PlayerState, 'queue' | 'queueIndex' | 'shuffle' | 'repeat'>): boolean {
  const { queue, queueIndex, shuffle, repeat } = state;
  if (queueIndex === null || queue.length === 0) return false;
  return (shuffle && queue.length > 1) || queueIndex < queue.length - 1 || repeat === 'all';
}

export function isNaturalTrackEnd(
  position: number,
  decodedDuration: number,
  expectedDuration = 0,
): boolean {
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
