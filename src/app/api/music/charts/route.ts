import { NextResponse } from 'next/server';
import { createRateLimiter } from '../rateLimit';
import { isPlayableTrack, trackToSong, type ItunesCountry, type ItunesTrack } from '@/lib/providers/itunesProvider';
import type { Song } from '@/types/music';

/**
 * Chart pages, built from Apple's published feeds and Apple's own preview
 * streams.
 *
 * The previous implementation took the chart titles from Apple and then tried
 * to find each one again on an unrelated catalog by fuzzy-matching title and
 * artist, because that catalog was the only thing that could stream. Two thirds
 * of every chart failed that match and the rest arrived flagged unplayable, so
 * the pages listed songs nobody could hear. Apple's feed already hands back the
 * track id its own preview endpoint takes, so a whole chart now resolves in a
 * single lookup with no matching, no guessing, and nothing unplayable.
 */
/**
 * One entry per region Apple actually publishes.
 *
 * `pop` used to live here too, on `us/most-played/50` — the same feed as
 * `billboard`, so two navigation entries rendered the identical fifty tracks —
 * and it was labelled "Global Top Songs". Apple's v2 feed API has no global
 * region at all (`gl` answers 500) and no feed type but `most-played`, so that
 * label described something that cannot exist. The Pop view is a genre browse
 * now; a chart is a region or it is nothing.
 */
const CHARTS = {
  billboard: { region: 'us', name: 'Apple US Top Songs' },
  uk: { region: 'gb', name: 'UK Top Songs' },
  jp: { region: 'jp', name: 'Japan Top Songs' },
} as const;

type ChartKey = keyof typeof CHARTS;

const CHART_SIZE = 50;
const LOOKUP_CHUNK = 50;
const UPSTREAM_TIMEOUT_MS = 6_000;
const TRACK_ID = /^[1-9]\d{0,15}$/;

/**
 * The home view asks for three charts on first paint. The window is sized
 * against one feed request plus one batch lookup, while a client looping over
 * the endpoint still cannot multiply itself without hitting the limiter.
 */
const rateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 60, maxEntries: 4_000 });

const lastSuccessfulCharts = new Map<ChartKey, { name: string; results: Song[]; savedAt: number }>();

interface FeedEntry {
  id?: string;
}

interface RssValue {
  label?: string;
  attributes?: Record<string, string | undefined>;
}

interface RssFeedEntry {
  'im:name'?: RssValue;
  'im:artist'?: RssValue;
  'im:collection'?: {
    'im:name'?: RssValue;
    link?: RssValue;
  };
  'im:image'?: RssValue[];
  link?: RssValue[];
  id?: RssValue;
  category?: { attributes?: Record<string, string | undefined> };
}

interface ChartFeed {
  ids: string[];
  tracks?: ItunesTrack[];
}

function chartTrackToSong(item: ItunesTrack, country: ItunesCountry): Song {
  // The chart endpoint serves Apple's fixed 30-second preview. `trackToSong`
  // keeps the full recording length separately as `recordingDuration`.
  return trackToSong(item, 0, 30, country);
}

function upstreamSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function lookupChunk(ids: string[], region: string, signal?: AbortSignal): Promise<ItunesTrack[]> {
  const url = `https://itunes.apple.com/lookup?id=${ids.join(',')}&entity=song&country=${region}&limit=200`;
  const response = await fetch(url, { next: { revalidate: 900 }, signal: upstreamSignal(signal) });
  if (!response.ok) return [];
  const data = (await response.json()) as { results?: ItunesTrack[] };
  return Array.isArray(data.results) ? data.results : [];
}

function numericId(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/(\d+)(?:\?|$)/);
  if (!match) return undefined;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

function rssTrackToItunesTrack(entry: RssFeedEntry, index: number): ItunesTrack | null {
  const trackId = entry.id?.attributes?.['im:id'] ?? numericId(entry.id?.label)?.toString();
  const artistUrl = entry['im:artist']?.attributes?.href;
  const collectionUrl = entry['im:collection']?.link?.attributes?.href;
  const trackUrl = entry.link?.find((link) => link.attributes?.rel === 'alternate')?.attributes?.href;
  const previewUrl = entry.link?.find((link) => link.attributes?.rel === 'enclosure')?.attributes?.href;
  const artworkUrl100 = entry['im:image']?.at(-1)?.label;
  const artistId = numericId(artistUrl);
  const collectionId = numericId(collectionUrl);
  if (
    !trackId ||
    !TRACK_ID.test(trackId) ||
    !entry['im:name']?.label ||
    !entry['im:artist']?.label ||
    !artistId ||
    !collectionId ||
    !previewUrl
  ) {
    return null;
  }

  return {
    wrapperType: 'track',
    kind: 'song',
    trackId: Number(trackId),
    trackName: entry['im:name'].label,
    artistId,
    artistName: entry['im:artist'].label,
    collectionId,
    collectionName: entry['im:collection']?.['im:name']?.label,
    artworkUrl100,
    previewUrl,
    trackNumber: index + 1,
    primaryGenreName: entry.category?.attributes?.term,
    trackViewUrl: trackUrl,
    artistViewUrl: artistUrl,
    collectionViewUrl: collectionUrl,
  };
}

function feedIds(feed: unknown): string[] {
  if (!feed || typeof feed !== 'object') return [];
  const results = (feed as { feed?: { results?: FeedEntry[] } }).feed?.results;
  if (!Array.isArray(results)) return [];
  return results.map((entry) => entry?.id).filter((id): id is string => typeof id === 'string' && TRACK_ID.test(id));
}

function rssTracks(feed: unknown): ItunesTrack[] {
  if (!feed || typeof feed !== 'object') return [];
  const entries = (feed as { feed?: { entry?: RssFeedEntry[] } }).feed?.entry;
  if (!Array.isArray(entries)) return [];
  return entries.map(rssTrackToItunesTrack).filter((track): track is ItunesTrack => track !== null);
}

async function fetchChartFeed(region: string, signal?: AbortSignal): Promise<ChartFeed> {
  const urls = [
    `https://rss.marketingtools.apple.com/api/v2/${region}/music/most-played/${CHART_SIZE}/songs.json`,
    `https://itunes.apple.com/${region}/rss/topsongs/limit=${CHART_SIZE}/json`,
  ];
  let lastError: unknown;

  for (const url of urls) {
    try {
      const response = await fetch(url, { next: { revalidate: 900 }, signal: upstreamSignal(signal) });
      if (!response.ok) continue;
      const body: unknown = await response.json();
      const ids = feedIds(body);
      if (ids.length > 0) return { ids };
      const tracks = rssTracks(body);
      if (tracks.length > 0) return { ids: tracks.map((track) => String(track.trackId)), tracks };
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Apple chart feed is unavailable');
}

function staleChartResponse(chart: ChartKey): NextResponse | null {
  const cached = lastSuccessfulCharts.get(chart);
  if (!cached) return null;
  return NextResponse.json(
    {
      name: cached.name,
      results: cached.results,
      stale: true,
      notice: 'Showing the last successful Apple chart while the upstream feed recovers.',
    },
    {
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Marea-Chart-Stale': 'true',
      },
    },
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  const chart = new URL(request.url).searchParams.get('chart') as ChartKey | null;
  if (!chart || !(chart in CHARTS)) return NextResponse.json({ error: 'Unknown chart' }, { status: 400 });
  // Bucketed per chart: exhausting the US chart must not lock a client out of
  // Japan's, which is a different feed and a different set of lookups.
  const limited = rateLimit(request, `charts:${chart}`);
  if (limited) return limited;
  const config = CHARTS[chart];

  try {
    const byTrackId = new Map<string, Song>();
    const feed = await fetchChartFeed(config.region, request.signal);
    if (feed.tracks) {
      for (const item of feed.tracks) {
        if (isPlayableTrack(item)) byTrackId.set(String(item.trackId), chartTrackToSong(item, config.region));
      }
    } else {
      const chunks: string[][] = [];
      for (let index = 0; index < feed.ids.length; index += LOOKUP_CHUNK) {
        chunks.push(feed.ids.slice(index, index + LOOKUP_CHUNK));
      }
      // One batch handles the whole 50-track chart. If a larger chart is
      // introduced later, a failed chunk still costs only its own entries.
      const settled = await Promise.allSettled(
        chunks.map((chunk) => lookupChunk(chunk, config.region, request.signal)),
      );
      for (const result of settled) {
        if (result.status !== 'fulfilled') continue;
        for (const item of result.value) {
          if (isPlayableTrack(item)) byTrackId.set(String(item.trackId), chartTrackToSong(item, config.region));
        }
      }
    }

    // Chart position is the whole point, so the feed's order wins over the
    // order the lookup happened to return.
    const results = feed.ids.map((id) => byTrackId.get(id)).filter((song): song is Song => song !== undefined);
    if (!results.length) {
      return (
        staleChartResponse(chart) ??
        NextResponse.json(
          { error: `${config.name} is unavailable`, provider: 'Apple Preview', unavailable: true },
          { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
        )
      );
    }

    lastSuccessfulCharts.set(chart, { name: config.name, results, savedAt: Date.now() });

    return NextResponse.json(
      { name: config.name, results },
      {
        headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800' },
      },
    );
  } catch {
    return (
      staleChartResponse(chart) ??
      NextResponse.json(
        { error: `${config.name} is unavailable`, provider: 'Apple Preview', unavailable: true },
        { status: 502, headers: { 'Cache-Control': 'private, no-store' } },
      )
    );
  }
}
