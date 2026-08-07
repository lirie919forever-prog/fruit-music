import type { Album, Artist, Song } from '@/types/music';
import {
  archiveProvider,
  audiusProvider,
  ccmixterProvider,
  deezerProvider,
  fipProvider,
  getMusicProviderForAlbumId,
  getMusicProviderForArtistId,
  getMusicProviderForName,
  getMusicProviderForSongId,
  itunesProvider,
  jamendoProvider,
  kexpProvider,
  kuwoProvider,
  lxmusicProvider,
  ntsProvider,
  openverseProvider,
  radioParadiseProvider,
  radioBrowserProvider,
  somaFmProvider,
  theCurrentProvider,
  wikimediaProvider,
} from '@/lib/providers';
import type { ProviderCatalogResult } from '@/lib/providers/types';
import { ProviderError, providerFetch } from '@/lib/providers/errors';
import { isLyricsResult, type LyricsResult } from '@/lib/lyrics/lrclib';
import { getPlaybackResolution, setPlaybackResolution } from '@/lib/playbackResolutionCache';
import { isSong } from '@/lib/songShape';
import { isPreviewSource, isResolverSource } from '@/lib/sourceRegistry';
import type {
  ChartKey,
  FederatedResult,
  FederatedSearchResult,
  MusicCatalog,
  PlaybackCandidate,
  PlaybackSource,
} from '@/lib/catalogTypes';

function dedupeEntities<T extends { id: string }>(entities: T[]): T[] {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    if (seen.has(entity.id)) return false;
    seen.add(entity.id);
    return true;
  });
}

/**
 * A source-first flat list makes one large provider feel like the whole
 * catalog. Genre shelves should alternate providers where possible, both for
 * variety and so a healthy public source remains visible when Jamendo has not
 * been configured for a local demo.
 */
function interleaveEntities<T extends { id: string }>(groups: T[][], limit: number): T[] {
  const seen = new Set<string>();
  const results: T[] = [];
  const longest = Math.max(0, ...groups.map((group) => group.length));

  for (let index = 0; index < longest && results.length < limit; index += 1) {
    for (const group of groups) {
      const item = group[index];
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      results.push(item);
      if (results.length >= limit) break;
    }
  }

  return results;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}

function normalizePlaybackText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function isPreviewSong(song: Song): boolean {
  return isPreviewSource(song.provider);
}

const MIN_RELIABLE_FULL_TRACK_SECONDS = 45;
const MAX_PLAYBACK_CANDIDATES = 8;
const PLAYBACK_PROBE_WORKERS = 3;
const VERSION_MARKERS = ['remix', 'live', 'instrumental', 'karaoke', 'cover', 'acoustic', 'sped up', 'slowed'];

function normalizedTokens(value: string): string[] {
  return normalizePlaybackText(value)
    .split(' ')
    .filter((token) => token.length > 1 && !['and', 'feat', 'featuring', 'ft', 'with'].includes(token));
}

function hasVersionMarker(value: string): boolean {
  return VERSION_MARKERS.some((marker) => value.includes(marker));
}

function primaryArtist(value: string): string {
  return value.split(/\s+(?:feat\.?|featuring|ft\.?)\s+|\s*[&,/]\s*/i)[0]?.trim() || value;
}

function recordingDuration(song: Pick<Song, 'duration' | 'recordingDuration'>): number {
  return song.recordingDuration && song.recordingDuration > 0 ? song.recordingDuration : song.duration;
}

function expectedPlaybackDuration(song: Pick<Song, 'provider' | 'duration' | 'recordingDuration'>): number {
  // A preview's `duration` is only the clip length. Its optional
  // `recordingDuration` is the full recording length and is the only reliable
  // value to compare against during substitution.
  if (isPreviewSource(song.provider)) {
    return song.recordingDuration && song.recordingDuration > 0 ? song.recordingDuration : 0;
  }
  return recordingDuration(song);
}

function hasCompatibleDuration(candidateDuration: number, expectedDuration: number): boolean {
  if (candidateDuration <= 0 || expectedDuration <= 0) return true;
  return Math.abs(candidateDuration - expectedDuration) <= Math.max(15, expectedDuration * 0.2);
}

function matchingFullTracks(
  candidates: Song[],
  title: string,
  artist: string,
  requireDuration = true,
  expectedDuration = 0,
): Song[] {
  const targetTitleTokens = normalizedTokens(title);
  const targetArtistTokens = normalizedTokens(artist);
  const targetHasVersionMarker = hasVersionMarker(title);

  const matches = candidates.flatMap((candidate, index) => {
    const candidateTitle = normalizePlaybackText(candidate.title);
    const candidateArtist = normalizePlaybackText(candidate.artist);
    const candidateTitleTokens = normalizedTokens(candidate.title);
    const candidateArtistTokens = normalizedTokens(candidate.artist);
    const sharedTitleTokens = targetTitleTokens.filter((token) => candidateTitleTokens.includes(token)).length;
    const sharedArtistTokens = targetArtistTokens.filter((token) => candidateArtistTokens.includes(token)).length;
    const artistMentionedInTitle = targetArtistTokens.filter((token) => candidateTitle.includes(token)).length;
    const artistMatch =
      candidateArtist === normalizePlaybackText(artist) ||
      sharedArtistTokens > 0 ||
      artistMentionedInTitle >= Math.min(2, targetArtistTokens.length);
    const titleTokenMatch =
      targetTitleTokens.length > 1 &&
      sharedTitleTokens === targetTitleTokens.length &&
      candidateTitleTokens.length <= targetTitleTokens.length + 2;
    const titleMatch =
      candidateTitle === title || candidateTitle.includes(title) || title.includes(candidateTitle) || titleTokenMatch;
    const candidateHasVersionMarker = hasVersionMarker(candidateTitle);
    const candidateDuration = recordingDuration(candidate);
    const suspiciousShortClip = candidateDuration > 0 && candidateDuration < MIN_RELIABLE_FULL_TRACK_SECONDS;
    const missingDuration = candidateDuration <= 0;
    if (
      !artistMatch ||
      !titleMatch ||
      suspiciousShortClip ||
      !hasCompatibleDuration(candidateDuration, expectedDuration) ||
      (candidateHasVersionMarker && !targetHasVersionMarker) ||
      (requireDuration && missingDuration)
    )
      return [];

    const score =
      (candidateTitle === title ? 8 : titleTokenMatch ? 6 : 4) +
      (candidateArtist === normalizePlaybackText(artist) ? 8 : sharedArtistTokens * 2) +
      (artistMentionedInTitle > 0 ? 1 : 0) +
      (candidate.metadataVerified ? 1 : 0);
    return [{ candidate, index, score }];
  });

  matches.sort((left, right) => right.score - left.score || left.index - right.index);
  return matches.map(({ candidate }) => candidate);
}

type FullTrackSearchSource = (query: string) => Promise<Song[]>;

interface FullTrackSearchOptions {
  queryLimit?: number;
  includeOpenSources?: boolean;
}

async function searchFullTrackSources(
  sources: FullTrackSearchSource[],
  queries: string[],
  title: string,
  artist: string,
  expectedDuration: number,
  signal?: AbortSignal,
  excludedIds: ReadonlySet<string> = new Set(),
): Promise<Song[]> {
  const providerResults = await Promise.allSettled(
    sources.map(async (search) => {
      for (const query of queries) {
        throwIfAborted(signal);
        const matches = matchingFullTracks(await search(query), title, artist, true, expectedDuration).filter(
          (candidate) => !excludedIds.has(candidate.id),
        );
        if (matches.length > 0) return matches;
      }
      return [];
    }),
  );
  for (const result of providerResults) {
    if (result.status === 'rejected') throwIfAborted(signal);
  }
  return providerResults.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
}

async function findFullTrackCandidates(
  song: Song,
  signal?: AbortSignal,
  excludedIds: ReadonlySet<string> = new Set(),
  options: FullTrackSearchOptions = {},
): Promise<Song[]> {
  const title = normalizePlaybackText(song.title);
  const artist = normalizePlaybackText(song.artist);
  const expectedDuration = expectedPlaybackDuration(song);
  if (!title || !artist) return [];

  const cached = getPlaybackResolution(song);
  if (cached) {
    return cached.candidates.filter((candidate) => !excludedIds.has(candidate.id)).slice(0, MAX_PLAYBACK_CANDIDATES);
  }

  // Kuwo is the primary mainstream matcher. Audius is a public full-track
  // catalog and is useful when Kuwo returns a mobile-only item; LX remains an
  // optional operator-configured adapter. Each source gets a small query ladder
  // because some catalog search endpoints rank the artist before the title.
  const queries = [
    ...new Set(
      [`${song.artist} ${song.title}`, `${song.title} ${primaryArtist(song.artist)}`, song.title]
        .map((query) => query.trim())
        .filter(Boolean),
    ),
  ].slice(0, Math.max(1, Math.min(options.queryLimit ?? 3, 3)));
  const primarySources: FullTrackSearchSource[] = [(query) => kuwoProvider.search(query, signal)];
  if (process.env.NEXT_PUBLIC_LX_ENABLED === 'true') {
    primarySources.push((query) => lxmusicProvider.search(query, signal));
  }
  primarySources.push((query) => audiusProvider.search(query, signal));

  let candidates = await searchFullTrackSources(
    primarySources,
    queries,
    title,
    artist,
    expectedDuration,
    signal,
    excludedIds,
  );
  if (candidates.length === 0 && options.includeOpenSources !== false) {
    // A mainstream resolver is not the only useful recovery path. These
    // sources carry openly licensed or creator-published full recordings and
    // can recover covers, live versions, and independent releases without
    // pretending an official preview is a full stream.
    const openSources: FullTrackSearchSource[] = [
      (query) => jamendoProvider.search(query, signal),
      (query) => ccmixterProvider.search(query, signal),
      (query) => archiveProvider.search(query, signal),
      (query) => openverseProvider.search(query, signal),
      (query) => wikimediaProvider.search(query, signal),
    ];
    candidates = await searchFullTrackSources(
      openSources,
      queries,
      title,
      artist,
      expectedDuration,
      signal,
      excludedIds,
    );
  }

  const seen = new Set<string>();
  const uniqueCandidates = candidates
    .filter((candidate) => {
      if (seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      return true;
    })
    .slice(0, MAX_PLAYBACK_CANDIDATES);
  if (uniqueCandidates.length > 0) setPlaybackResolution(song, { candidates: uniqueCandidates });
  return uniqueCandidates;
}

async function getVerifiedStreamUrl(song: Song, signal?: AbortSignal): Promise<string | null> {
  try {
    const streamUrl = await getMusicProviderForName(song.provider).getStreamUrl(song, signal);
    return streamUrl || null;
  } catch {
    throwIfAborted(signal);
    return null;
  }
}

function isReusablePlaybackUrl(streamUrl: string): boolean {
  // Kuwo/LX proxy paths are stable application URLs. Audius URLs contain
  // short-lived signatures and must be requested fresh on every play.
  return streamUrl.startsWith('/api/music/');
}

interface VerifiedPlaybackCandidate {
  index: number;
  streamUrl: string;
}

function createLinkedAbortController(parent?: AbortSignal): {
  controller: AbortController;
  dispose: () => void;
} {
  const controller = new AbortController();
  if (!parent) return { controller, dispose: () => undefined };

  const onAbort = () => controller.abort(parent.reason);
  if (parent.aborted) onAbort();
  else parent.addEventListener('abort', onAbort, { once: true });

  return {
    controller,
    dispose: () => parent.removeEventListener('abort', onAbort),
  };
}

/**
 * Probes a small pool of candidates while retaining source priority. A slow
 * first candidate no longer serializes every fallback, but a later candidate
 * is only selected after all higher-priority candidates have settled.
 */
async function findFirstVerifiedCandidate(
  candidates: Song[],
  signal?: AbortSignal,
): Promise<VerifiedPlaybackCandidate | null> {
  const limitedCandidates = candidates.slice(0, MAX_PLAYBACK_CANDIDATES);
  if (limitedCandidates.length === 0) return null;

  const linked = createLinkedAbortController(signal);
  const settled = new Map<number, string | null>();
  const inFlight = new Map<number, Promise<{ index: number; streamUrl: string | null }>>();
  let nextIndex = 0;

  const fillPool = () => {
    while (
      nextIndex < limitedCandidates.length &&
      inFlight.size < Math.min(PLAYBACK_PROBE_WORKERS, limitedCandidates.length) &&
      !linked.controller.signal.aborted
    ) {
      const index = nextIndex;
      nextIndex += 1;
      const probe = getVerifiedStreamUrl(limitedCandidates[index], linked.controller.signal).then(
        (streamUrl) => ({ index, streamUrl }),
        () => ({ index, streamUrl: null }),
      );
      inFlight.set(index, probe);
    }
  };

  try {
    fillPool();
    while (inFlight.size > 0) {
      const result = await Promise.race(inFlight.values());
      inFlight.delete(result.index);
      throwIfAborted(signal);
      settled.set(result.index, result.streamUrl);

      // The first settled success is not necessarily the preferred one. Walk
      // from the front so a fast lower-priority candidate cannot win a race
      // against a higher-priority probe that is still in flight.
      for (let index = 0; index < limitedCandidates.length; index += 1) {
        if (!settled.has(index)) break;
        const streamUrl = settled.get(index);
        if (!streamUrl) continue;
        linked.controller.abort(new DOMException('Playback candidate selected', 'AbortError'));
        return { index, streamUrl };
      }

      fillPool();
    }

    return null;
  } finally {
    if (!linked.controller.signal.aborted)
      linked.controller.abort(new DOMException('Playback probe complete', 'AbortError'));
    linked.dispose();
  }
}

async function findFullTrackFallback(
  song: Song,
  signal?: AbortSignal,
  options: FullTrackSearchOptions = {},
): Promise<Song | null> {
  try {
    for (const candidate of await findFullTrackCandidates(song, signal, new Set(), options)) {
      if (await getVerifiedStreamUrl(candidate, signal)) return candidate;
    }
    return null;
  } catch {
    throwIfAborted(signal);
    return null;
  }
}

const CHART_FULL_TRACK_LIMIT = 12;
const CHART_FULL_TRACK_WORKERS = 3;
const CHART_FULL_TRACK_TIMEOUT_MS = 4_500;
const CHART_FULL_TRACK_SEARCH_OPTIONS: FullTrackSearchOptions = {
  queryLimit: 3,
  includeOpenSources: false,
};

async function resolveChartFullTracks(songs: Song[], signal?: AbortSignal): Promise<Song[]> {
  const resolved = songs.slice();
  let nextIndex = 0;
  const candidates = songs.slice(0, CHART_FULL_TRACK_LIMIT);
  const linked = createLinkedAbortController(signal);
  const resolutionSignal = linked.controller.signal;

  const workers = Promise.all(
    Array.from({ length: Math.min(CHART_FULL_TRACK_WORKERS, candidates.length) }, async () => {
      while (nextIndex < candidates.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          const fullTrack = await findFullTrackFallback(
            candidates[index],
            resolutionSignal,
            CHART_FULL_TRACK_SEARCH_OPTIONS,
          );
          if (fullTrack) {
            resolved[index] =
              fullTrack.duration > 0 ? fullTrack : { ...fullTrack, duration: candidates[index].duration };
          }
        } catch {
          // A chart row remains usable as Apple's official preview when the
          // bounded optional hydration pass is cancelled or times out.
          throwIfAborted(signal);
        }
      }
    }),
  );

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      workers,
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, CHART_FULL_TRACK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (!resolutionSignal.aborted) {
      linked.controller.abort(new DOMException('Chart hydration complete', 'AbortError'));
    }
    await Promise.allSettled([workers]);
    linked.dispose();
  }

  throwIfAborted(signal);
  return resolved;
}

type CatalogProvider<T> = {
  name: string;
  get: (signal: AbortSignal) => Promise<ProviderCatalogResult<T>>;
};

function scopeCatalogProviders<T>(providers: Array<CatalogProvider<T>>, source?: string): Array<CatalogProvider<T>> {
  if (!source || source === 'all') return providers;
  return providers.filter((provider) => provider.name === source);
}

const CATALOG_PROVIDER_TIMEOUT_MS = 5_000;
const CATALOG_FEDERATION_TIMEOUT_MS = 4_500;

async function settleCatalogProvider<T>(
  provider: CatalogProvider<T>,
  providerController: AbortController,
): Promise<ProviderCatalogResult<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutBound = new Promise<ProviderCatalogResult<T>>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new ProviderError(provider.name, 'catalog', 'timeout', 504)),
      CATALOG_PROVIDER_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([provider.get(providerController.signal), timeoutBound]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    providerController.abort(new DOMException('Provider deadline reached', 'TimeoutError'));
  }
}

async function federateCatalog<T extends { id: string }>(
  providers: Array<CatalogProvider<T>>,
  signal?: AbortSignal,
): Promise<FederatedResult<T>> {
  const providerControllers = providers.map(() => new AbortController());
  const abortProviders = (reason: unknown) => {
    for (const controller of providerControllers) {
      if (!controller.signal.aborted) controller.abort(reason);
    }
  };
  const abortFromExternal = () => abortProviders(signal?.reason);
  if (signal?.aborted) abortFromExternal();
  else signal?.addEventListener('abort', abortFromExternal, { once: true });
  const settled: Array<PromiseSettledResult<ProviderCatalogResult<T>> | undefined> = Array.from(
    { length: providers.length },
    () => undefined,
  );
  const providerResults = providers.map((provider, index) =>
    settleCatalogProvider(provider, providerControllers[index]).then(
      (value) => {
        settled[index] = { status: 'fulfilled', value };
      },
      (reason: unknown) => {
        settled[index] = { status: 'rejected', reason };
      },
    ),
  );
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(providerResults),
    new Promise<void>((resolve) => {
      deadlineTimer = setTimeout(resolve, CATALOG_FEDERATION_TIMEOUT_MS);
    }),
  ]);
  abortProviders(new DOMException('Federation deadline reached', 'TimeoutError'));
  if (deadlineTimer) clearTimeout(deadlineTimer);
  if (signal) signal.removeEventListener('abort', abortFromExternal);
  throwIfAborted(signal);
  const complete = settled.map(
    (result, index): PromiseSettledResult<ProviderCatalogResult<T>> =>
      result ?? {
        status: 'rejected',
        reason: new ProviderError(providers[index].name, 'catalog', 'timeout', 504),
      },
  );
  // Jamendo is deliberately optional in a local Marea install. Treating a
  // missing client id as an outage made every otherwise healthy New page show
  // a permanent warning, which is neither useful nor truthful.
  const notConfigured = complete.map(
    (result) =>
      result.status === 'rejected' && result.reason instanceof ProviderError && result.reason.code === 'not_configured',
  );
  const failedProviders = complete.flatMap((result, index) =>
    result.status === 'rejected' && !notConfigured[index] ? [providers[index].name] : [],
  );
  const degradedProviders = complete.flatMap((result, index) =>
    result.status === 'fulfilled' && result.value.degraded ? [providers[index].name] : [],
  );
  const results = dedupeEntities(
    complete.flatMap((result) => (result.status === 'fulfilled' ? result.value.results : [])),
  );

  return {
    results,
    failedProviders,
    ...(degradedProviders.length > 0 ? { degradedProviders } : {}),
    providerCount: providers.length - notConfigured.filter(Boolean).length,
  };
}

export async function searchFederated(
  query: string,
  signal?: AbortSignal,
  source?: string,
): Promise<FederatedSearchResult> {
  // Apple leads the list because it is the only source here that can answer a
  // search for a mainstream release. The Creative Commons providers still run —
  // they carry the full-length recordings Apple only previews — but a query for
  // a song everybody knows used to return nothing at all.
  const providers: Array<CatalogProvider<Song>> = [
    { name: 'Audius', get: async (sig) => ({ results: await audiusProvider.search(query, sig) }) },
    { name: 'Wikimedia Commons', get: async (sig) => ({ results: await wikimediaProvider.search(query, sig) }) },
    { name: 'Jamendo', get: async (sig) => ({ results: await jamendoProvider.search(query, sig) }) },
    { name: 'ccMixter', get: (sig) => ccmixterProvider.searchWithStatus(query, sig) },
    { name: 'Archive', get: async (sig) => ({ results: await archiveProvider.search(query, sig) }) },
    { name: 'Openverse', get: async (sig) => ({ results: await openverseProvider.search(query, sig) }) },
    { name: 'SomaFM', get: async (sig) => ({ results: await somaFmProvider.search(query, sig) }) },
    { name: 'NTS Radio', get: async (sig) => ({ results: await ntsProvider.search(query, sig) }) },
    {
      name: 'Radio Paradise',
      get: async (sig) => ({ results: await radioParadiseProvider.search(query, sig) }),
    },
    { name: 'KEXP', get: async (sig) => ({ results: await kexpProvider.search(query, sig) }) },
    { name: 'FIP', get: async (sig) => ({ results: await fipProvider.search(query, sig) }) },
    { name: 'The Current', get: async (sig) => ({ results: await theCurrentProvider.search(query, sig) }) },
    { name: 'Radio Browser', get: async (sig) => ({ results: await radioBrowserProvider.search(query, sig) }) },
    { name: 'Apple Preview', get: async (sig) => ({ results: await itunesProvider.search(query, sig) }) },
    { name: 'Deezer Preview', get: async (sig) => ({ results: await deezerProvider.search(query, sig) }) },
    { name: 'Kuwo', get: async (sig) => ({ results: await kuwoProvider.search(query, sig) }) },
  ];
  const lxEnabled = process.env.NEXT_PUBLIC_LX_ENABLED === 'true';
  if (lxEnabled) {
    providers.push({ name: 'LX Music', get: async (sig) => ({ results: await lxmusicProvider.search(query, sig) }) });
  }
  return federateCatalog(scopeCatalogProviders(providers, source), signal);
}

/**
 * A genre is a discovery request, not a Jamendo-only feature. Apple makes the
 * shelf recognisable with official previews, Audius contributes creator-owned
 * streams, and the Creative Commons providers broaden the long tail. Jamendo
 * remains optional when no local client id is configured.
 */
export async function getGenreSongs(tag: string, limit = 50, signal?: AbortSignal): Promise<FederatedResult<Song>> {
  const normalizedTag = tag.trim();
  if (!normalizedTag) {
    return { results: [], failedProviders: [], providerCount: 0 };
  }

  const normalizedLimit = Number.isFinite(limit) ? Math.floor(limit) : 50;
  const cappedLimit = Math.max(1, Math.min(normalizedLimit, 50));
  // Archive enriches its search records one at a time, so it cannot be treated
  // like a cheap keyword endpoint. Keep this discovery path limited to catalog
  // providers; Kuwo is reserved for on-demand full-track resolution because its
  // media resolver must be probed before a result can be trusted.
  const perProviderLimit = Math.min(20, Math.max(8, Math.ceil(cappedLimit / 6)));
  const providers: Array<CatalogProvider<Song>> = [
    {
      name: 'Audius',
      get: async (sig) => ({ results: await audiusProvider.getSongsByTag(normalizedTag, perProviderLimit, sig) }),
    },
    {
      name: 'Wikimedia Commons',
      get: async (sig) => ({ results: await wikimediaProvider.getSongsByTag(normalizedTag, perProviderLimit, sig) }),
    },
    {
      name: 'Jamendo',
      get: async (sig) => ({ results: await jamendoProvider.getSongsByTag(normalizedTag, perProviderLimit, sig) }),
    },
    {
      name: 'Openverse',
      get: async (sig) => ({ results: await openverseProvider.getSongsByTag(normalizedTag, perProviderLimit, sig) }),
    },
  ];
  const lxEnabled = process.env.NEXT_PUBLIC_LX_ENABLED === 'true';
  if (lxEnabled) {
    providers.push({
      name: 'LX Music',
      get: async (sig) => ({ results: await lxmusicProvider.getSongsByTag(normalizedTag, perProviderLimit, sig) }),
    });
  }
  if (normalizedTag.toLowerCase() === 'classical') {
    providers.push({
      name: 'Archive',
      get: async (sig) => ({ results: await archiveProvider.getSongsByTag(normalizedTag, perProviderLimit, sig) }),
    });
  } else {
    providers.push({
      name: 'ccMixter',
      get: (sig) => ccmixterProvider.getSongsByTagWithStatus(normalizedTag, perProviderLimit, sig),
    });
  }
  const catalog = await federateCatalog(providers, signal);

  return {
    ...catalog,
    results: interleaveEntities(
      providers.map(({ name }) => catalog.results.filter((song) => song.provider === name)),
      cappedLimit,
    ),
  };
}

/**
 * A small, dependable live shelf deserves its own request rather than being a
 * side effect of a much larger trending federation. The providers deliver
 * continuous audio, so this can be a listener's fastest route into playback
 * while the on-demand catalog is still loading.
 */
export async function getLiveStations(limit = 12, signal?: AbortSignal): Promise<FederatedResult<Song>> {
  const normalizedLimit = Number.isFinite(limit) ? Math.floor(limit) : 12;
  const cappedLimit = Math.max(1, Math.min(normalizedLimit, 64));
  const providers: Array<CatalogProvider<Song>> = [
    { name: 'SomaFM', get: async (sig) => ({ results: await somaFmProvider.getTrending(perProviderLimit, sig) }) },
    { name: 'NTS Radio', get: async (sig) => ({ results: await ntsProvider.getTrending(perProviderLimit, sig) }) },
    {
      name: 'Radio Paradise',
      get: async (sig) => ({ results: await radioParadiseProvider.getTrending(perProviderLimit, sig) }),
    },
    { name: 'KEXP', get: async (sig) => ({ results: await kexpProvider.getTrending(perProviderLimit, sig) }) },
    { name: 'FIP', get: async (sig) => ({ results: await fipProvider.getTrending(perProviderLimit, sig) }) },
    {
      name: 'The Current',
      get: async (sig) => ({ results: await theCurrentProvider.getTrending(perProviderLimit, sig) }),
    },
    {
      name: 'Radio Browser',
      get: async (sig) => ({ results: await radioBrowserProvider.getTrending(perProviderLimit, sig) }),
    },
  ];
  const perProviderLimit = Math.min(20, Math.max(4, Math.ceil(cappedLimit / providers.length)));
  const catalog = await federateCatalog(providers, signal);

  return {
    ...catalog,
    results: interleaveEntities(
      providers.map(({ name }) => catalog.results.filter((song) => song.provider === name)),
      cappedLimit,
    ),
  };
}

/**
 * Album and artist search, federated across the providers that have an index
 * for them.
 *
 * Not every provider does: ccMixter and Archive have no album or artist search
 * at all, and calling their track search here would return matches that are not
 * albums. Those providers stay out of these two lists rather than being
 * approximated, so an empty artists section means nobody matched, not that
 * somebody was skipped.
 */
export async function searchAlbumsFederated(
  query: string,
  signal?: AbortSignal,
  source?: string,
): Promise<FederatedResult<Album>> {
  const providers: Array<CatalogProvider<Album>> = [
    { name: 'Audius', get: async (sig) => ({ results: await audiusProvider.searchAlbums(query, sig) }) },
    {
      name: 'Wikimedia Commons',
      get: async (sig) => ({ results: await wikimediaProvider.searchAlbums(query, sig) }),
    },
    { name: 'Jamendo', get: async (sig) => ({ results: await jamendoProvider.searchAlbums(query, sig) }) },
    { name: 'Apple Preview', get: async (sig) => ({ results: await itunesProvider.searchAlbums(query, sig) }) },
    { name: 'Deezer Preview', get: async (sig) => ({ results: await deezerProvider.searchAlbums(query, sig) }) },
  ];
  return federateCatalog(scopeCatalogProviders(providers, source), signal);
}

export async function searchArtistsFederated(
  query: string,
  signal?: AbortSignal,
  source?: string,
): Promise<FederatedResult<Artist>> {
  const providers: Array<CatalogProvider<Artist>> = [
    { name: 'Audius', get: async (sig) => ({ results: await audiusProvider.searchArtists(query, sig) }) },
    {
      name: 'Wikimedia Commons',
      get: async (sig) => ({ results: await wikimediaProvider.searchArtists(query, sig) }),
    },
    { name: 'Jamendo', get: async (sig) => ({ results: await jamendoProvider.searchArtists(query, sig) }) },
    { name: 'Apple Preview', get: async (sig) => ({ results: await itunesProvider.searchArtists(query, sig) }) },
    { name: 'Deezer Preview', get: async (sig) => ({ results: await deezerProvider.searchArtists(query, sig) }) },
  ];
  return federateCatalog(scopeCatalogProviders(providers, source), signal);
}

export function isServerConfigured(): boolean {
  return true;
}

export const api = {
  async getAlbums(signal?: AbortSignal): Promise<FederatedResult<Album>> {
    const providers: Array<CatalogProvider<Album>> = [
      { name: 'Audius', get: async (sig) => ({ results: await audiusProvider.getAlbums(sig) }) },
      { name: 'Wikimedia Commons', get: async (sig) => ({ results: await wikimediaProvider.getAlbums(sig) }) },
      { name: 'Jamendo', get: async (sig) => ({ results: await jamendoProvider.getAlbums(sig) }) },
      { name: 'ccMixter', get: (sig) => ccmixterProvider.getAlbumsWithStatus(sig) },
      { name: 'Apple Preview', get: async (sig) => ({ results: await itunesProvider.getAlbums(sig) }) },
      { name: 'Deezer Preview', get: async (sig) => ({ results: await deezerProvider.getAlbums(sig) }) },
    ];
    return federateCatalog(providers, signal);
  },

  async getArtists(signal?: AbortSignal): Promise<FederatedResult<Artist>> {
    const providers: Array<CatalogProvider<Artist>> = [
      { name: 'Audius', get: async (sig) => ({ results: await audiusProvider.getArtists(sig) }) },
      { name: 'Wikimedia Commons', get: async (sig) => ({ results: await wikimediaProvider.getArtists(sig) }) },
      { name: 'Jamendo', get: async (sig) => ({ results: await jamendoProvider.getArtists(sig) }) },
      { name: 'ccMixter', get: (sig) => ccmixterProvider.getArtistsWithStatus(sig) },
      { name: 'Apple Preview', get: async (sig) => ({ results: await itunesProvider.getArtists(sig) }) },
      { name: 'Deezer Preview', get: async (sig) => ({ results: await deezerProvider.getArtists(sig) }) },
    ];
    return federateCatalog(providers, signal);
  },

  // A direct provider lookup comes first because the federated catalog only
  // returns one page per provider; a deep link to any record outside that page
  // would otherwise report an unavailable album/artist that in fact exists.
  async resolveAlbum(albumId: string, signal?: AbortSignal): Promise<Album | null> {
    if (!albumId) return null;
    const provider = getMusicProviderForAlbumId(albumId);
    if (provider.getAlbumById) {
      const album = await provider.getAlbumById(albumId, signal);
      if (album) return album;
      throwIfAborted(signal);
    }
    const result = await this.getAlbums(signal);
    return result.results.find((album) => album.id === albumId) ?? null;
  },

  async resolveArtist(artistId: string, signal?: AbortSignal): Promise<Artist | null> {
    if (!artistId) return null;
    const provider = getMusicProviderForArtistId(artistId);
    if (provider.getArtistById) {
      const artist = await provider.getArtistById(artistId, signal);
      if (artist) return artist;
      throwIfAborted(signal);
    }
    const result = await this.getArtists(signal);
    return result.results.find((artist) => artist.id === artistId) ?? null;
  },

  async getAlbumSongs(albumId: string, signal?: AbortSignal): Promise<Song[]> {
    return getMusicProviderForAlbumId(albumId).getAlbumSongs(albumId, signal);
  },

  async getArtistSongs(artistId: string, signal?: AbortSignal): Promise<Song[]> {
    return getMusicProviderForArtistId(artistId).getArtistSongs(artistId, signal);
  },

  // A discography is one provider's answer about its own artist, so this asks
  // that provider directly instead of federating: no other catalog knows what
  // belongs under this id.
  async getArtistAlbums(artistId: string, signal?: AbortSignal): Promise<Album[]> {
    const provider = getMusicProviderForArtistId(artistId);
    return provider.getArtistAlbums ? provider.getArtistAlbums(artistId, signal) : [];
  },

  search: searchFederated,
  searchAlbums: searchAlbumsFederated,
  searchArtists: searchArtistsFederated,

  async getSongsByTag(tag: string, limit?: number, signal?: AbortSignal): Promise<Song[]> {
    return (await getGenreSongs(tag, limit, signal)).results;
  },

  getGenreSongs,

  getLiveStations,

  async getRecentReleases(limit = 20, signal?: AbortSignal): Promise<Song[]> {
    return itunesProvider.getRecentReleases(limit, signal);
  },

  async getCcmixterSongsByTag(tag: string, limit = 50, signal?: AbortSignal): Promise<FederatedResult<Song>> {
    return federateCatalog(
      [
        {
          name: 'ccMixter',
          get: (sig) => ccmixterProvider.getSongsByTagWithStatus(tag, limit, sig),
        },
      ],
      signal,
    );
  },

  async getTrending(limit = 50, signal?: AbortSignal): Promise<FederatedResult<Song>> {
    const requestedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 50;
    const providers: Array<CatalogProvider<Song>> = [
      { name: 'Audius', get: async (sig) => ({ results: await audiusProvider.getTrending(requestedLimit, sig) }) },
      {
        name: 'Wikimedia Commons',
        get: async (sig) => ({ results: await wikimediaProvider.getTrending(requestedLimit, sig) }),
      },
      { name: 'Jamendo', get: async (sig) => ({ results: await jamendoProvider.getTrending(requestedLimit, sig) }) },
      { name: 'ccMixter', get: (sig) => ccmixterProvider.getTrendingWithStatus(requestedLimit, sig) },
      { name: 'Archive', get: async (sig) => ({ results: await archiveProvider.getTrending(requestedLimit, sig) }) },
      {
        name: 'Openverse',
        get: async (sig) => ({ results: await openverseProvider.getTrending(requestedLimit, sig) }),
      },
      {
        name: 'Deezer Preview',
        get: async (sig) => ({ results: await deezerProvider.getTrending(requestedLimit, sig) }),
      },
    ];
    const lxEnabled = process.env.NEXT_PUBLIC_LX_ENABLED === 'true';
    if (lxEnabled) {
      providers.push({
        name: 'LX Music',
        get: async (sig) => ({ results: await lxmusicProvider.getTrending(requestedLimit, sig) }),
      });
    }
    const catalog = await federateCatalog(providers, signal);

    return {
      ...catalog,
      results: interleaveEntities(
        providers.map(({ name }) => catalog.results.filter((song) => song.provider === name)),
        requestedLimit,
      ),
    };
  },

  async getChartSongs(chart: ChartKey, signal?: AbortSignal): Promise<Song[]> {
    const data = await providerFetch<{ results?: unknown; error?: string; unavailable?: boolean }>(
      'Apple Preview',
      'chart',
      '/api/music/charts',
      { chart },
      signal,
      { timeoutMs: 15_000 },
    );
    if (data.error) {
      throw new ProviderError('Apple Preview', 'chart', 'upstream', 502, data.error);
    }
    if (!Array.isArray(data.results)) {
      throw new ProviderError('Apple Preview', 'chart', 'invalid_response');
    }
    // Every other provider maps its upstream through a shape check on the way
    // in; this one used to cast the JSON body to `Song[]` and hand it to the
    // UI. It is still a network response, and it is the only path that skipped
    // that step. A malformed entry is dropped rather than allowed to throw
    // inside a row; a body with nothing usable in it is a failure, not an
    // empty chart.
    const results = data.results.filter(isSong);
    if (results.length === 0) {
      throw new ProviderError('Apple Preview', 'chart', 'invalid_response');
    }
    // Keep the Apple ranking intact when a resolver cannot verify a matching
    // full recording. Verified replacements are an enhancement, not a reason
    // to delete mainstream chart entries or surface an empty chart.
    return resolveChartFullTracks(results, signal);
  },

  /**
   * Lyrics for a track, or `null` when nobody has them.
   *
   * "Nobody has them" is the common answer — most of this catalog is Creative
   * Commons music that LRCLIB has never been asked about — so a miss is a
   * normal result rather than an error. Only a server that could not answer at
   * all throws, which is what lets the panel tell "no lyrics exist" apart from
   * "the lookup is broken".
   */
  async getLyrics(song: Song, signal?: AbortSignal): Promise<LyricsResult | null> {
    const data = await providerFetch<{ found?: boolean; lyrics?: unknown }>(
      'LRCLIB',
      'lyrics',
      '/api/lyrics',
      {
        track: song.title,
        artist: song.artist,
        ...(song.album ? { album: song.album } : {}),
        duration: String(song.duration),
      },
      signal,
    );
    return data.found === true && isLyricsResult(data.lyrics) ? data.lyrics : null;
  },

  async resolveSong(songId: string, signal?: AbortSignal): Promise<Song | null> {
    const provider = getMusicProviderForSongId(songId);
    return provider.getSongById ? provider.getSongById(songId, signal) : null;
  },

  async getStreamUrl(song: Song, signal?: AbortSignal): Promise<string> {
    return getMusicProviderForName(song.provider).getStreamUrl(song, signal);
  },

  /**
   * Finds exact-match recovery candidates without making them a prerequisite
   * for a direct stream. The player calls this only after a Kuwo/LX response
   * fails or proves to be a short clip.
   */
  async getPlaybackAlternates(song: Song, signal?: AbortSignal): Promise<PlaybackCandidate[]> {
    if (!isResolverSource(song.provider)) return [];
    return (await findFullTrackCandidates(song, signal, new Set([song.id]))).map((candidate) => ({ song: candidate }));
  },

  async getPlaybackSource(song: Song, signal?: AbortSignal): Promise<PlaybackSource> {
    if (isPreviewSong(song)) {
      try {
        const candidates = await findFullTrackCandidates(song, signal);
        const cached = getPlaybackResolution(song);
        const cachedIndex = cached?.selectedId
          ? candidates.findIndex((candidate) => candidate.id === cached.selectedId)
          : -1;
        const verified =
          cachedIndex >= 0 && cached?.streamUrl
            ? { index: cachedIndex, streamUrl: cached.streamUrl }
            : await findFirstVerifiedCandidate(candidates, signal);
        if (verified) {
          setPlaybackResolution(song, {
            candidates,
            selectedId: candidates[verified.index].id,
            ...(isReusablePlaybackUrl(verified.streamUrl) ? { streamUrl: verified.streamUrl } : {}),
          });
          const resolved: PlaybackCandidate[] = candidates.map((item, candidateIndex) =>
            candidateIndex === verified.index ? { song: item, streamUrl: verified.streamUrl } : { song: item },
          );
          const first: PlaybackSource = { song: candidates[verified.index], streamUrl: verified.streamUrl };
          const alternates = resolved.slice(verified.index + 1);
          return alternates.length > 0 ? { ...first, candidates: [first, ...alternates] } : first;
        }
      } catch {
        throwIfAborted(signal);
      }
    }
    try {
      const streamUrl = await this.getStreamUrl(song, signal);
      // Do not await alternate searches here. A healthy direct source should
      // be playable immediately, and a failed optional source must not turn it
      // into a resolution error. Alternates are resolved lazily by the player
      // only when the direct media response is unusable.
      return { song, streamUrl };
    } catch (error) {
      throwIfAborted(signal);
      // A Kuwo search result can be a catalog identity whose resolver only
      // permits the mobile app. Give the same exact-match recovery path a
      // chance to find a public full recording before surfacing the failure.
      if (!isResolverSource(song.provider)) throw error;
      const fallbackCandidates = await this.getPlaybackAlternates(song, signal);
      const verified = await findFirstVerifiedCandidate(
        fallbackCandidates.map((candidate) => candidate.song),
        signal,
      );
      if (verified) {
        setPlaybackResolution(song, {
          candidates: fallbackCandidates.map((candidate) => candidate.song),
          selectedId: fallbackCandidates[verified.index].song.id,
          ...(isReusablePlaybackUrl(verified.streamUrl) ? { streamUrl: verified.streamUrl } : {}),
        });
        const remaining = fallbackCandidates.slice(verified.index + 1);
        return remaining.length > 0
          ? {
              song: fallbackCandidates[verified.index].song,
              streamUrl: verified.streamUrl,
              candidates: [
                { song: fallbackCandidates[verified.index].song, streamUrl: verified.streamUrl },
                ...remaining,
              ],
            }
          : { song: fallbackCandidates[verified.index].song, streamUrl: verified.streamUrl };
      }
      throw error;
    }
  },

  isServerConfigured,
} satisfies MusicCatalog;

export type {
  ChartKey,
  FederatedResult,
  FederatedSearchResult,
  MusicCatalog,
  PlaybackCandidate,
  PlaybackSource,
} from '@/lib/catalogTypes';
