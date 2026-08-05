'use client';

import { RotateCw, ExternalLink, BarChart3, Globe, Info, Search, Music, ListMusic, Signal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  MUSIC_SOURCE_REGISTRY,
  type MusicSourceDefinition,
  type SourceCapability,
  type SourceReadiness,
} from '@/lib/sourceRegistry';
import { fetchSourceHealth } from '@/lib/sourceHealthClient';

type SourceFilter = 'all' | SourceCapability;

const FILTERS: Array<{ value: SourceFilter; label: string }> = [
  { value: 'all', label: 'All sources' },
  { value: 'full', label: 'Full tracks' },
  { value: 'match', label: 'Resolver matches' },
  { value: 'live', label: 'Live radio' },
  { value: 'preview', label: 'Official previews' },
  { value: 'metadata', label: 'Metadata' },
];

function CapabilityIcon({ capability }: { capability: SourceCapability }): ReactNode {
  if (capability === 'match') return <ListMusic className="h-4 w-4" aria-hidden />;
  if (capability === 'live') return <Signal className="h-4 w-4" aria-hidden />;
  if (capability === 'preview') return <BarChart3 className="h-4 w-4" aria-hidden />;
  if (capability === 'metadata') return <Info className="h-4 w-4" aria-hidden />;
  return <Music className="h-4 w-4" aria-hidden />;
}

function CapabilityBadge({ capability }: { capability: SourceCapability }) {
  const label =
    capability === 'live'
      ? 'Live'
      : capability === 'match'
        ? 'Match'
        : capability === 'preview'
          ? 'Preview'
          : capability === 'metadata'
            ? 'Metadata'
            : 'Full';
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#edf6fa] px-2 py-1 text-[11px] font-semibold text-[var(--salt-primary)]">
      <CapabilityIcon capability={capability} />
      {label}
    </span>
  );
}

function IntegrationBadge({ readiness }: { readiness?: SourceReadiness }) {
  const label =
    readiness === 'ready'
      ? 'Ready'
      : readiness === 'setup-required'
        ? 'Setup required'
        : readiness === 'disabled'
          ? 'Disabled'
          : readiness === 'metadata-only'
            ? 'Metadata only'
            : 'Checking';
  const className =
    readiness === 'ready'
      ? 'bg-[#edf8ef] text-[#317447]'
      : readiness === 'setup-required'
        ? 'bg-[#fff5df] text-[#8a5b00]'
        : 'bg-[#f3f5f6] text-[var(--salt-mist)]';
  return <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${className}`}>{label}</span>;
}

function isVisible(source: MusicSourceDefinition, filter: SourceFilter): boolean {
  return filter === 'all' || source.capabilities.includes(filter);
}

export function SourceDirectoryView({ onSearchSource }: { onSearchSource?: (source: string) => void }) {
  const [filter, setFilter] = useState<SourceFilter>('all');
  const [health, setHealth] = useState<Awaited<ReturnType<typeof fetchSourceHealth>> | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [isHealthLoading, setIsHealthLoading] = useState(true);
  const lxEnabled = process.env.NEXT_PUBLIC_LX_ENABLED === 'true';
  const visibleSources = useMemo(() => MUSIC_SOURCE_REGISTRY.filter((source) => isVisible(source, filter)), [filter]);
  const refreshHealth = useCallback(async (signal?: AbortSignal) => {
    setIsHealthLoading(true);
    try {
      setHealth(await fetchSourceHealth(signal));
      setHealthError(false);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setHealthError(true);
    } finally {
      if (!signal?.aborted) setIsHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void refreshHealth(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [refreshHealth]);

  const healthByName = useMemo(() => new Map((health ?? []).map((item) => [item.name, item])), [health]);
  const readinessFor = (source: MusicSourceDefinition): SourceReadiness | undefined =>
    healthByName.get(source.name)?.readiness;
  const connectedSource = (source: MusicSourceDefinition) => {
    const readiness = readinessFor(source);
    return readiness
      ? readiness === 'ready'
      : source.integration === 'active' || (source.integration === 'optional' && lxEnabled);
  };
  const playableSources = MUSIC_SOURCE_REGISTRY.filter(
    (source) => connectedSource(source) && source.capabilities.includes('full'),
  ).length;
  const matchSources = MUSIC_SOURCE_REGISTRY.filter(
    (source) => connectedSource(source) && source.capabilities.includes('match'),
  ).length;
  const liveSources = MUSIC_SOURCE_REGISTRY.filter(
    (source) => connectedSource(source) && source.capabilities.includes('live'),
  ).length;
  const metadataSources = MUSIC_SOURCE_REGISTRY.filter((source) => source.integration === 'metadata-only').length;
  const connectedSources = MUSIC_SOURCE_REGISTRY.filter(connectedSource).length;

  return (
    <section className="space-y-6 pb-8">
      <header className="max-w-3xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--salt-primary)]">
          Source registry
        </p>
        <h2 className="mt-1 text-3xl font-bold tracking-[-0.03em] text-[var(--salt-white)] sm:text-4xl">
          Know where every track comes from.
        </h2>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-[var(--salt-mist)]">
          Marea keeps direct full-track catalogs, resolver matches, live stations, official previews, and metadata
          references separate. Ready means this build has the configuration needed to invoke the adapter; upstream
          outages are still reported in the view that queried them.
        </p>
      </header>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <SummaryStat value={connectedSources} label="Ready adapters" />
        <SummaryStat value={playableSources} label="Full-track catalogs" />
        <SummaryStat value={matchSources} label="Resolver match sources" />
        <SummaryStat value={liveSources} label="Live radio networks" />
        <SummaryStat value={metadataSources} label="Metadata references" />
      </div>

      <div
        className="flex max-w-3xl flex-wrap items-center gap-1 rounded-xl bg-[var(--salt-ghost)] p-1"
        role="radiogroup"
        aria-label="Filter music sources"
      >
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={`min-h-9 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] ${filter === option.value ? 'bg-white text-[var(--salt-white)] shadow-sm' : 'text-[var(--salt-mist)] hover:text-[var(--salt-white)]'}`}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void refreshHealth()}
          disabled={isHealthLoading}
          aria-label="Refresh source status"
          title="Refresh source status"
          className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--salt-mist)] transition-colors hover:bg-white hover:text-[var(--salt-primary)] disabled:cursor-wait disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
        >
          <RotateCw className={`h-4 w-4 ${isHealthLoading ? 'animate-spin' : ''}`} aria-hidden />
        </button>
      </div>

      {healthError && (
        <p className="max-w-3xl text-xs text-[#8a5b00]" role="status">
          Server readiness could not be checked. Showing build-time source defaults.
        </p>
      )}

      <div className="marea-glass-surface divide-y divide-[var(--glass-border)] overflow-hidden rounded-xl border">
        {visibleSources.map((source) => {
          const sourceHealth = healthByName.get(source.name);
          const readiness = sourceHealth?.readiness;
          const searchable =
            source.searchable &&
            source.integration !== 'metadata-only' &&
            (readiness ? readiness === 'ready' : source.integration !== 'optional' || lxEnabled);

          return (
            <article key={source.name} className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eaf4f7] text-[var(--salt-primary)]">
                  <Globe className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-[var(--salt-white)]">{source.name}</h3>
                    <IntegrationBadge readiness={readiness} />
                  </div>
                  <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[var(--salt-mist)]">
                    {source.description}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {source.capabilities.map((capability) => (
                      <CapabilityBadge key={capability} capability={capability} />
                    ))}
                    <span className="text-[11px] text-[var(--salt-mist)]">{source.note}</span>
                    <span className="text-[11px] text-[var(--salt-mist)]">
                      {sourceHealth?.detail ?? 'Checking server readiness'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {searchable && onSearchSource && (
                  <button
                    type="button"
                    onClick={() => onSearchSource?.(source.name)}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-[var(--salt-primary)] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#1f6f9b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
                  >
                    Search source
                    <Search className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
                {source.homepage && (
                  <a
                    href={source.homepage}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-[var(--glass-border)] px-3 text-xs font-semibold text-[var(--salt-primary)] transition-colors hover:bg-[var(--glass-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
                  >
                    Open source
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SummaryStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="marea-glass-surface rounded-xl border px-4 py-3">
      <p className="text-2xl font-bold text-[var(--salt-white)]">{value}</p>
      <p className="mt-1 text-xs text-[var(--salt-mist)]">{label}</p>
    </div>
  );
}
