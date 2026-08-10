import type { Album, Artist, MusicProviderName, Song } from '@/types/music';
import {
  archiveProvider,
  audiusProvider,
  bilibiliProvider,
  invidiousProvider,
  neteaseProvider,
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
  radioFranceProvider,
  qqMusicProvider,
  wikimediaProvider,
} from '@/lib/providers';
import type { ProviderCatalogResult } from '@/lib/providers/types';
import { ProviderError, providerFetch } from '@/lib/providers/errors';
import { isLyricsResult, type LyricsResult } from '@/lib/lyrics/lrclib';
import { getPlaybackResolution, setPlaybackResolution } from '@/lib/playbackResolutionCache';
import { isSong } from '@/lib/songShape';
import { isPreviewSource, isResolverSource } from '@/lib/sourceRegistry';
import { NO_VERIFIED_FULL_TRACK_MESSAGE } from '@/lib/catalogTypes';
import type {
  ChartFetchOptions,
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

// Track-oriented providers sometimes have to synthesize an album record so a
// song can still carry album-shaped metadata. Those records are useful for
// playback and deep links, but they make the browse view look like an archive
// file listing rather than a catalog of releases.
const PSEUDO_ALBUM_NAMES = new Set([
  'internet archive',
  'no album',
  'unknown',
  'unknown album',
  'untitled',
  'untitled album',
  'wikimedia commons',
]);

function isBrowsableAlbum(album: Album): boolean {
  const normalizedName = album.name.trim().toLocaleLowerCase();
  return !album.id.startsWith('wikimedia-album-') && !PSEUDO_ALBUM_NAMES.has(normalizedName);
}

function filterBrowsableAlbums(catalog: FederatedResult<Album>): FederatedResult<Album> {
  return { ...catalog, results: catalog.results.filter(isBrowsableAlbum) };
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
const PLAYBACK_PROBE_TIMEOUT_MS = 4_500;
const PLAYBACK_RESOLUTION_TIMEOUT_MS = 8_000;
const VERSION_MARKERS = [
  'remix',
  'live',
  'instrumental',
  'karaoke',
  'cover',
  'acoustic',
  'music box',
  'piano',
  'guitar',
  'orchestra',
  'acapella',
  'a cappella',
  'sped up',
  'slowed',
  'preview',
  'version',
  'ver.',
  'edit',
  'movie',
  '\u8bd5\u542c',
  '\u8a66\u8074',
  '\u73b0\u573a',
  '\u73fe\u5834',
  '\u5267\u573a\u7248',
  '\u5287\u5834\u7248',
  '\u4f34\u594f',
  '\u30aa\u30eb\u30b4\u30fc\u30eb',
  '\u30ab\u30e9\u30aa\u30b1',
  '\u30ab\u30d0\u30fc',
  '\u6b4c\u3063\u3066\u307f\u305f',
  '\u30d4\u30a2\u30ce',
  '\u30ae\u30bf\u30fc',
  '\u30aa\u30fc\u30b1\u30b9\u30c8\u30e9',
];

function normalizedTokens(value: string): string[] {
  return normalizePlaybackText(value)
    .split(' ')
    .filter((token) => token.length > 1 && !['and', 'feat', 'featuring', 'ft', 'with'].includes(token));
}

function hasVersionMarker(value: string): boolean {
  const normalizedValue = normalizePlaybackText(value);
  return VERSION_MARKERS.some((marker) => normalizedValue.includes(normalizePlaybackText(marker)));
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

function needsCatalogArtwork(song: Pick<Song, 'coverArt'>): boolean {
  return !song.coverArt || song.coverArt === '/placeholder-album.svg' || song.coverArt.startsWith('data:image/svg+xml');
}

/**
 * Exact resolver matches can be the real recording while still lacking a
 * public cover image. Keep their source attribution and stream identity, but
 * retain the selected catalog artwork when it is the only listener-friendly
 * image available. This matters most in the full player, where a generated
 * initial would otherwise become the dominant visual after a successful swap.
 */
function withCatalogArtwork(candidate: Song, catalogSong: Song): Song {
  if (!needsCatalogArtwork(candidate) || needsCatalogArtwork(catalogSong)) return candidate;
  return { ...candidate, coverArt: catalogSong.coverArt };
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
  allowExplicitArtistTitleMatch = false,
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
    const candidateArtistIsUnknown = !candidateArtist || candidateArtist === 'unknown';
    const titleTokenMatch =
      targetTitleTokens.length > 1 &&
      sharedTitleTokens === targetTitleTokens.length &&
      candidateTitleTokens.length <= targetTitleTokens.length + 2;
    const titleMatch =
      candidateTitle === title || candidateTitle.includes(title) || title.includes(candidateTitle) || titleTokenMatch;
    const explicitArtistTitleMatch =
      titleMatch && targetArtistTokens.length > 0 && artistMentionedInTitle >= targetArtistTokens.length;
    const artistMatch =
      candidateArtist === normalizePlaybackText(artist) ||
      sharedArtistTokens > 0 ||
      (candidateArtistIsUnknown && artistMentionedInTitle >= Math.min(2, targetArtistTokens.length)) ||
      (allowExplicitArtistTitleMatch && explicitArtistTitleMatch);
    // Resolver catalogs frequently put the arrangement label in the artist or
    // album field instead of the title (for example a Japanese "music box"
    // artist whose title only repeats the original artist and track). Treat all
    // three fields as recording-version evidence so chart hydration cannot
    // promote an instrumental cover as the mainstream recording.
    const candidateHasVersionMarker = hasVersionMarker(
      `${candidateTitle} ${candidateArtist} ${normalizePlaybackText(candidate.album)}`,
    );
    const candidateDuration = recordingDuration(candidate);
    const suspiciousShortClip = candidateDuration > 0 && candidateDuration < MIN_RELIABLE_FULL_TRACK_SECONDS;
    const missingDuration = candidateDuration <= 0;
    if (
      candidate.playbackUnavailable === true ||
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

type FullTrackSearchSource = (query: string, signal?: AbortSignal) => Promise<Song[]>;

interface FullTrackSearchOptions {
  queryLimit?: number;
  includeOpenSources?: boolean;
  includeAudius?: boolean;
  /** Background chart hydration should degrade quietly when Kuwo is unavailable. */
  softResolverSearch?: boolean;
  /** Optional resolver search is opt-in; implicit recovery must stay reliable. */
  includeLx?: boolean;
  excludeProvider?: MusicProviderName;
  /** Chart hydration may accept a record that names the target artist in its title. */
  allowExplicitArtistTitleMatch?: boolean;
}

async function searchFullTrackSources(
  sources: FullTrackSearchSource[],
  queries: string[],
  title: string,
  artist: string,
  expectedDuration: number,
  signal?: AbortSignal,
  excludedIds: ReadonlySet<string> = new Set(),
  allowExplicitArtistTitleMatch = false,
): Promise<Song[]> {
  if (sources.length === 0) return [];

  // A per-search AbortController cancels slow source HTTP requests
  // as soon as a fast source finds matches. Without this, abandoned fetch
  // requests (e.g., Invidious at 12s) would saturate the browser's fetch
  // connection pool and delay later chart rows.
  const linked = createLinkedAbortController(signal);
  const searchSignal = linked.controller.signal;
  const allMatches: Song[] = [];
  let earlyResolve!: () => void;
  const matchedOrAllDone = new Promise<void>((resolve) => {
    earlyResolve = resolve;
  });

  const sourcePromises = sources.map(async (search) => {
    try {
      for (const query of queries) {
        throwIfAborted(searchSignal);
        if (allMatches.length > 0) return;
        const matches = matchingFullTracks(
          await search(query, searchSignal),
          title,
          artist,
          true,
          expectedDuration,
          allowExplicitArtistTitleMatch,
        ).filter((candidate) => !excludedIds.has(candidate.id));
        if (matches.length > 0) {
          allMatches.push(...matches);
          earlyResolve();
          // Cancel remaining in-flight source HTTP requests so they stop
          // occupying the browser's fetch connection pool.
          if (!searchSignal.aborted) {
            linked.controller.abort(new DOMException('Search matched early', 'AbortError'));
          }
          return;
        }
      }
    } catch {
      // Aborted by the linked controller or an upstream signal; throw only
      // if the parent signal aborted.
      throwIfAborted(signal);
    }
  });

  // Resolve as soon as either (a) any source finds matches, or (b) all
  // sources have settled without finding anything.
  await Promise.race([
    matchedOrAllDone,
    Promise.allSettled(sourcePromises).then(() => earlyResolve()),
  ]);
  linked.dispose();
  return allMatches;
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

  // Kuwo and QQ Music are mainstream matchers. QQ returns an explicit public
  // signed URL only for records it permits on the web, and that URL is probed
  // before it can replace an official preview. Audius is a public full-track
  // catalog and is useful when a mainstream resolver has no web playback; LX
  // remains an optional operator-configured adapter. Each source gets a small
  // query ladder because catalog endpoints rank artist and title differently.
  const queries = [
    ...new Set(
      [`${song.artist} ${song.title}`, `${song.title} ${primaryArtist(song.artist)}`, song.title]
        .map((query) => query.trim())
        .filter(Boolean),
    ),
  ].slice(0, Math.max(1, Math.min(options.queryLimit ?? 3, 3)));
  const primarySources: FullTrackSearchSource[] = [];
  if (options.excludeProvider !== 'Kuwo') {
    primarySources.push((query, sourceSignal) =>
      kuwoProvider.search(query, sourceSignal, options.softResolverSearch ? { soft: true } : undefined),
    );
  }
  if (options.excludeProvider !== 'QQ Music') {
    primarySources.push((query, sourceSignal) => qqMusicProvider.search(query, sourceSignal));
  }
  if (options.excludeProvider !== 'Bilibili') {
    primarySources.push((query, sourceSignal) => bilibiliProvider.search(query, sourceSignal));
  }
  if (options.excludeProvider !== 'Invidious') {
    primarySources.push((query, sourceSignal) => invidiousProvider.search(query, sourceSignal));
  }
  if (options.excludeProvider !== 'Netease') {
    primarySources.push((query, sourceSignal) => neteaseProvider.search(query, sourceSignal));
  }
  if (
    options.includeLx === true &&
    options.excludeProvider !== 'LX Music' &&
    process.env.NEXT_PUBLIC_LX_ENABLED === 'true'
  ) {
    primarySources.push((query, sourceSignal) => lxmusicProvider.search(query, sourceSignal));
  }
  if (options.includeAudius !== false && options.excludeProvider !== 'Audius') {
    primarySources.push((query, sourceSignal) => audiusProvider.search(query, sourceSignal));
  }

  let candidates = await searchFullTrackSources(
    primarySources,
    queries,
    title,
    artist,
    expectedDuration,
    signal,
    excludedIds,
    options.allowExplicitArtistTitleMatch,
  );
  if (candidates.length === 0 && options.includeOpenSources !== false) {
    // A mainstream resolver is not the only useful recovery path. These
    // sources carry openly licensed or creator-published full recordings and
    // can recover covers, live versions, and independent releases without
    // pretending an official preview is a full stream.
    const openSources: FullTrackSearchSource[] = [
      (query, sourceSignal) => jamendoProvider.search(query, sourceSignal),
      (query, sourceSignal) => ccmixterProvider.search(query, sourceSignal),
      (query, sourceSignal) => archiveProvider.search(query, sourceSignal),
      (query, sourceSignal) => openverseProvider.search(query, sourceSignal),
      (query, sourceSignal) => wikimediaProvider.search(query, sourceSignal),
    ];
    candidates = await searchFullTrackSources(
      openSources,
      queries,
      title,
      artist,
      expectedDuration,
      signal,
      excludedIds,
      options.allowExplicitArtistTitleMatch,
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
    const streamUrl = await withPlaybackDeadline(
      (probeSignal) => getMusicProviderForName(song.provider).getStreamUrl(song, probeSignal),
      signal,
      PLAYBACK_PROBE_TIMEOUT_MS,
    );
    throwIfAborted(signal);
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

async function withPlaybackDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parent: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  const linked = createLinkedAbortController(parent);
  const timeoutError = new DOMException('Playback resolution timed out', 'TimeoutError');
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      linked.controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(linked.controller.signal), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (!linked.controller.signal.aborted) {
      linked.controller.abort(new DOMException('Playback resolution complete', 'AbortError'));
    }
    linked.dispose();
  }
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

async function resolvePreviewPlaybackSource(song: Song, signal: AbortSignal): Promise<PlaybackSource | null> {
  // A preview is a catalog identity, not a playable fallback. Resolve it to a
  // verified full recording before allowing a play request to reach audio.
  const candidates = (
    await findFullTrackCandidates(song, signal, new Set(), {
      includeLx: true,
      includeOpenSources: false,
    })
  ).map((candidate) => withCatalogArtwork(candidate, song));
  const cached = getPlaybackResolution(song);
  const cachedIndex = cached?.selectedId ? candidates.findIndex((candidate) => candidate.id === cached.selectedId) : -1;
  const verified =
    cachedIndex >= 0 && cached?.streamUrl
      ? { index: cachedIndex, streamUrl: cached.streamUrl }
      : await findFirstVerifiedCandidate(candidates, signal);
  if (!verified) return null;

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

interface SharedPreviewSourceRequest {
  controller: AbortController;
  promise: Promise<PlaybackSource | null>;
  consumers: number;
  settled: boolean;
  abortTimer: ReturnType<typeof setTimeout> | null;
}

const previewSourceRequests = new Map<string, SharedPreviewSourceRequest>();

function previewSourceRequestKey(song: Pick<Song, 'id' | 'provider'>): string {
  return `${song.provider}|${song.id}`;
}

function abortedRequestReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}

function releasePreviewSourceRequest(request: SharedPreviewSourceRequest): void {
  request.consumers = Math.max(0, request.consumers - 1);
  if (request.consumers > 0 || request.settled || request.controller.signal.aborted || request.abortTimer) return;

  // React's development effect replay cleans up and starts the same playback
  // request within one task. Giving it that brief handoff keeps normal
  // cancellation while avoiding a second resolver fan-out for one Play press.
  request.abortTimer = setTimeout(() => {
    request.abortTimer = null;
    if (request.consumers === 0 && !request.settled && !request.controller.signal.aborted) {
      request.controller.abort(new DOMException('Playback request no longer needed', 'AbortError'));
    }
  }, 0);
}

function waitForPreviewSourceRequest(
  request: SharedPreviewSourceRequest,
  signal?: AbortSignal,
): Promise<PlaybackSource | null> {
  throwIfAborted(signal);
  if (request.abortTimer) {
    clearTimeout(request.abortTimer);
    request.abortTimer = null;
  }
  request.consumers += 1;

  return new Promise((resolve, reject) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      signal?.removeEventListener('abort', onAbort);
      releasePreviewSourceRequest(request);
    };
    const onAbort = () => {
      release();
      reject(abortedRequestReason(signal));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    request.promise.then(
      (source) => {
        release();
        resolve(source);
      },
      (error) => {
        release();
        reject(error);
      },
    );
  });
}

function getSharedPreviewPlaybackSource(song: Song, signal?: AbortSignal): Promise<PlaybackSource | null> {
  throwIfAborted(signal);
  const key = previewSourceRequestKey(song);
  let request = previewSourceRequests.get(key);
  if (!request || request.controller.signal.aborted) {
    const controller = new AbortController();
    request = {
      controller,
      promise: Promise.resolve(null),
      consumers: 0,
      settled: false,
      abortTimer: null,
    };
    request.promise = withPlaybackDeadline(
      (resolutionSignal) => resolvePreviewPlaybackSource(song, resolutionSignal),
      controller.signal,
      PLAYBACK_RESOLUTION_TIMEOUT_MS,
    ).finally(() => {
      request!.settled = true;
      if (request!.abortTimer) clearTimeout(request!.abortTimer);
      request!.abortTimer = null;
      if (previewSourceRequests.get(key) === request) previewSourceRequests.delete(key);
    });
    previewSourceRequests.set(key, request);
  }

  return waitForPreviewSourceRequest(request, signal);
}

async function findFullTrackFallback(
  song: Song,
  signal?: AbortSignal,
  options: FullTrackSearchOptions = {},
): Promise<Song | null> {
  try {
    for (const candidate of await findFullTrackCandidates(song, signal, new Set(), options)) {
      if (await getVerifiedStreamUrl(candidate, signal)) return withCatalogArtwork(candidate, song);
    }
    return null;
  } catch {
    throwIfAborted(signal);
    return null;
  }
}

// Warm the complete ranked chart with a bounded resolver pass. A chart row is
// allowed to remain visibly marked as a preview when no verified full source
// exists, but the resolver must have had a chance to inspect every ranked row
// before the UI presents it as playable.
const CHART_FULL_TRACK_LIMIT = 50;
const CHART_SHELF_TRACK_LIMIT = 18;
const CHART_FULL_TRACK_WORKERS = 8;
const CHART_SHELF_WORKERS = 2;
const CHART_FULL_TRACK_TIMEOUT_MS = PLAYBACK_RESOLUTION_TIMEOUT_MS + 20_000;
const CHART_SHELF_TIMEOUT_MS = PLAYBACK_RESOLUTION_TIMEOUT_MS + 5_000;

// Audius rate-limits aggressively (429) when hit in a background fan-out.
// Disabling it for chart hydration eliminates the most common resolver
// noise source while keeping it available for user-initiated playback.
const CHART_FULL_TRACK_SEARCH_OPTIONS: FullTrackSearchOptions = {
  // Use the same query ladder as an explicit Play action. The matcher still
  // requires title, artist, duration, and version compatibility, so this does
  // not promote a merely similar cover to a chart recording.
  queryLimit: 3,
  includeOpenSources: false,
  includeAudius: false,
  includeLx: true,
  softResolverSearch: true,
};

async function resolveChartFullTracks(
  songs: Song[],
  signal: AbortSignal | undefined,
  options: ChartFetchOptions = {},
): Promise<Song[]> {
  const rowLimit = options.rowLimit ?? CHART_FULL_TRACK_LIMIT;
  const workers = rowLimit <= CHART_SHELF_TRACK_LIMIT ? CHART_SHELF_WORKERS : CHART_FULL_TRACK_WORKERS;
  const timeoutMs = rowLimit <= CHART_SHELF_TRACK_LIMIT ? CHART_SHELF_TIMEOUT_MS : CHART_FULL_TRACK_TIMEOUT_MS;
  const searchOptions: FullTrackSearchOptions = {
    ...CHART_FULL_TRACK_SEARCH_OPTIONS,
    includeAudius: options.includeAudius === true,
  };

  const resolved = songs.slice();
  let nextIndex = 0;
  const chartCandidates = songs.slice(0, Math.min(rowLimit, songs.length));
  const linked = createLinkedAbortController(signal);
  const resolutionSignal = linked.controller.signal;

  const workerPromises = Promise.all(
    Array.from({ length: Math.min(workers, chartCandidates.length) }, async () => {
      while (nextIndex < chartCandidates.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          const fullTrack = await findFullTrackFallback(
            chartCandidates[index],
            resolutionSignal,
            searchOptions,
          );
          if (fullTrack) {
            resolved[index] =
              fullTrack.duration > 0
                ? withCatalogArtwork(fullTrack, chartCandidates[index])
                : withCatalogArtwork({ ...fullTrack, duration: chartCandidates[index].duration }, chartCandidates[index]);
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
      workerPromises,
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (!resolutionSignal.aborted) {
      linked.controller.abort(new DOMException('Chart hydration complete', 'AbortError'));
    }
    await Promise.allSettled([workerPromises]);
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

/**
 * LX is optional at deployment time, but once configured it belongs in the
 * normal catalog and exact-match recovery path. The source picker can still
 * scope the request to one provider without paying for the other adapters.
 */
function shouldIncludeOptionalLx(source?: string): boolean {
  return process.env.NEXT_PUBLIC_LX_ENABLED === 'true' && (!source || source === 'all' || source === 'LX Music');
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
  // search for a mainstream release. The Creative Commons providers still run —  // they carry the full-length recordings Apple only previews —but a query for
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
    { name: 'Radio France', get: async (sig) => ({ results: await radioFranceProvider.search(query, sig) }) },
    { name: 'Radio Browser', get: async (sig) => ({ results: await radioBrowserProvider.search(query, sig) }) },
    { name: 'Apple Preview', get: async (sig) => ({ results: await itunesProvider.search(query, sig) }) },
    { name: 'Deezer Preview', get: async (sig) => ({ results: await deezerProvider.search(query, sig) }) },
    { name: 'Kuwo', get: async (sig) => ({ results: await kuwoProvider.search(query, sig) }) },
    { name: 'QQ Music', get: async (sig) => ({ results: await qqMusicProvider.search(query, sig) }) },
    { name: 'Bilibili', get: async (sig) => ({ results: await bilibiliProvider.search(query, sig) }) },
    { name: 'Invidious', get: async (sig) => ({ results: await invidiousProvider.search(query, sig) }) },
    { name: 'Netease', get: async (sig) => ({ results: await neteaseProvider.search(query, sig) }) },
  ];
  if (shouldIncludeOptionalLx(source)) {
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
      name: 'Radio France',
      get: async (sig) => ({ results: await radioFranceProvider.getTrending(perProviderLimit, sig) }),
    },
    {
      name: 'Radio Browser',
      get: async (sig) => ({ results: await radioBrowserProvider.getTrending(perProviderLimit, sig) }),
    },
    {
      name: 'Japan FM',
      get: async (sig) => ({ results: await radioBrowserProvider.getCountryStations('JP', perProviderLimit, sig) }),
    },
  ];
  const perProviderLimit = Math.min(20, Math.max(4, Math.ceil(cappedLimit / providers.length)));
  const catalog = await federateCatalog(providers, signal);

  return {
    ...catalog,
    results: interleaveEntities(
      providers.map(({ name }) =>
        name === 'Japan FM'
          ? catalog.results.filter((song) => song.provider === 'Radio Browser' && song.artistId === 'radio-artist-JP')
          : catalog.results.filter((song) => song.provider === name),
      ),
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
  return filterBrowsableAlbums(await federateCatalog(scopeCatalogProviders(providers, source), signal));
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
    return filterBrowsableAlbums(await federateCatalog(providers, signal));
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
    const albums = provider.getArtistAlbums ? await provider.getArtistAlbums(artistId, signal) : [];
    return albums.filter(isBrowsableAlbum);
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
    const catalog = await federateCatalog(providers, signal);

    return {
      ...catalog,
      results: interleaveEntities(
        providers.map(({ name }) => catalog.results.filter((song) => song.provider === name)),
        requestedLimit,
      ),
    };
  },

  async getChartSongs(chart: ChartKey, signal?: AbortSignal, options: ChartFetchOptions = {}): Promise<Song[]> {
    const data = await providerFetch<{ results?: unknown; error?: string; unavailable?: boolean }>(
      'Apple Preview',
      'chart',
      '/api/music/charts',
      { chart },
      signal,
      // The route has an official RSS fallback and may need one upstream
      // retry before returning a chart. Keep the client window above that
      // bounded server path so a transient Apple delay does not look like an
      // empty Japanese catalog.
      { timeoutMs: 30_000 },
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
    // full recording. The home shelf defers that optional resolver fan-out
    // until a listener presses play; dedicated charts can still enrich their
    // visible rows ahead of time.
    return options.resolveFullTracks === false ? results : resolveChartFullTracks(results, signal, options);
  },

  /**
   * Lyrics for a track, or `null` when nobody has them.
   *
   * "Nobody has them" is the common answer —most of this catalog is Creative
   * Commons music that LRCLIB has never been asked about —so a miss is a
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
    try {
      const candidates = await withPlaybackDeadline(
        async (resolutionSignal) => {
          const fullCandidates = (
            await findFullTrackCandidates(song, resolutionSignal, new Set([song.id]), {
              excludeProvider: song.provider,
              includeLx: true,
              queryLimit: 2,
              includeOpenSources: false,
            })
          ).map((candidate) => withCatalogArtwork(candidate, song));
          // Resolver selections promise a full recording. An Apple/Deezer
          // preview is an explicit catalog choice, not a valid recovery for a
          // resolver failure, so it must never enter this candidate ladder.
          return fullCandidates;
        },
        signal,
        PLAYBACK_RESOLUTION_TIMEOUT_MS,
      );
      return candidates.map((candidate) => ({ song: candidate }));
    } catch {
      throwIfAborted(signal);
      return [];
    }
  },

  async getPlaybackSource(song: Song, signal?: AbortSignal): Promise<PlaybackSource> {
    if (isPreviewSong(song)) {
      try {
        const resolvedSource = await getSharedPreviewPlaybackSource(song, signal);
        if (resolvedSource) return resolvedSource;
      } catch {
        throwIfAborted(signal);
      }
      throw new Error(NO_VERIFIED_FULL_TRACK_MESSAGE);
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
      let fallback: { fallbackCandidates: Song[]; verified: VerifiedPlaybackCandidate | null } | null = null;
      try {
        fallback = await withPlaybackDeadline(
          async (resolutionSignal) => {
            const fallbackCandidates = (
              await findFullTrackCandidates(song, resolutionSignal, new Set([song.id]), {
                excludeProvider: song.provider,
                includeLx: true,
                queryLimit: 2,
                includeOpenSources: false,
              })
            ).map((candidate) => withCatalogArtwork(candidate, song));
            const verified = await findFirstVerifiedCandidate(fallbackCandidates, resolutionSignal);
            if (verified) return { fallbackCandidates, verified };

            // A resolver selection promises a full recording. Falling back to
            // an official preview here would silently turn a failed full-track
            // request into a 30-second playback session.
            return { fallbackCandidates, verified: null };
          },
          signal,
          PLAYBACK_RESOLUTION_TIMEOUT_MS,
        );
      } catch {
        throwIfAborted(signal);
      }
      if (!fallback) throw error;
      const fallbackCandidates = fallback.fallbackCandidates.map((candidate) => ({ song: candidate }));
      const verified = fallback.verified;
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
