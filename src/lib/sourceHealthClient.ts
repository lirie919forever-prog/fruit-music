import type { SourceHealthSnapshot, SourceReadiness } from './sourceRegistry';

const READINESS_VALUES: readonly SourceReadiness[] = ['ready', 'setup-required', 'disabled', 'metadata-only'];

function isSourceHealthSnapshot(value: unknown): value is SourceHealthSnapshot {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<SourceHealthSnapshot>;
  return (
    typeof row.name === 'string' &&
    typeof row.detail === 'string' &&
    READINESS_VALUES.includes(row.readiness as SourceReadiness)
  );
}

/**
 * Keeps source-directory I/O outside the view. The route is a server-owned
 * readiness boundary, so the client validates its response before it enters
 * the normalized source registry UI.
 */
export async function fetchSourceHealth(signal?: AbortSignal): Promise<SourceHealthSnapshot[]> {
  const response = await fetch('/api/music/health', { cache: 'no-store', signal });
  if (!response.ok) throw new Error('Source status request failed');

  const payload: unknown = await response.json();
  const sources =
    payload && typeof payload === 'object' && Array.isArray((payload as { sources?: unknown }).sources)
      ? (payload as { sources: unknown[] }).sources.filter(isSourceHealthSnapshot)
      : [];
  if (sources.length === 0) throw new Error('Source status response was empty');
  return sources;
}
