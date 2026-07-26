import type { Query } from '@tanstack/react-query';

export const CATALOG_STALE_TIME_MS = 60_000;

/**
 * Providers intermittently answer a valid catalog request with zero records.
 * Treating that as fresh strands a view on an empty or "unavailable" state for
 * the whole stale window, even though the next request would succeed. An empty
 * result is therefore never held as fresh, so React Query refetches it on the
 * next opportunity instead of serving the gap back to the user.
 */
export function catalogStaleTime(countResults: (data: unknown) => number) {
  return <TQueryFnData, TData>(
    query: Query<TQueryFnData, Error, TData, readonly unknown[]>,
  ): number => (countResults(query.state.data) === 0 ? 0 : CATALOG_STALE_TIME_MS);
}

export function countFederatedResults(data: unknown): number {
  if (!data || typeof data !== 'object') return 0;
  const results = (data as { results?: unknown }).results;
  return Array.isArray(results) ? results.length : 0;
}

export function countListResults(data: unknown): number {
  return Array.isArray(data) ? data.length : countFederatedResults(data);
}
