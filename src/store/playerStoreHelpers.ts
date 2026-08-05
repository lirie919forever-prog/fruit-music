/** Pure playback-queue helpers extracted from the player store so the store
 *  file stays focused on state wiring. These are module-level, dependency-free
 *  utilities over the queue indexes. */
/** How far back `previous` can retrace. Matches the visible history length. */
export const MAX_PLAYED_HISTORY = 30;

/**
 * A shuffled walk over every queue index, with `startIndex` pinned to the
 * front so the track already playing stays where it is.
 *
 * Fisher-Yates over the whole bag rather than a random pick per step: picking
 * each time is sampling with replacement, which repeats tracks and leaves
 * others unreached. Drawing an order up front guarantees each track plays once
 * per lap.
 */
export function buildShuffleOrder(length: number, startIndex: number): number[] {
  if (length <= 0) return [];
  const rest = Array.from({ length }, (_, index) => index).filter((index) => index !== startIndex);
  for (let index = rest.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [rest[index], rest[swap]] = [rest[swap], rest[index]];
  }
  return [startIndex, ...rest];
}

/**
 * Accepts an order only if it is still a permutation of the current queue.
 * Anything that touched the queue invalidates it, and a stale order would
 * either skip tracks or index past the end.
 */
export function validShuffleOrder(order: number[], length: number): number[] | null {
  if (order.length !== length) return null;
  const seen = new Set(order);
  return seen.size === length && order.every((index) => Number.isInteger(index) && index >= 0 && index < length)
    ? order
    : null;
}

export function rememberPlayed(played: number[], index: number): number[] {
  return [...played, index].slice(-MAX_PLAYED_HISTORY);
}
