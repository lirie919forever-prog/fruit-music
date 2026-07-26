export const END_TOLERANCE_SECONDS = 2;

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
