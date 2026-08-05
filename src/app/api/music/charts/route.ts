import { NextResponse } from 'next/server';
import { createRateLimiter } from '../rateLimit';
import { isPlayableTrack, trackToSong, type ItunesTrack } from '@/lib/providers/itunesProvider';
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
const LOOKUP_CHUNK = 25;
const UPSTREAM_TIMEOUT_MS = 8_000;
const TRACK_ID = /^[1-9]\d{0,15}$/;

/**
 * One call here fans out to three upstream requests — the feed plus two id
 * lookups — and the home view asks for three charts on first paint. The window
 * is sized against that: a browser doing normal work stays far inside it, while
 * a client looping over the endpoint cannot multiply itself by three against
 * Apple.
 */
const rateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 60, maxEntries: 4_000 });

interface FeedEntry {
  id?: string;
}

function chartTrackToSong(item: ItunesTrack): Song {
  // The chart endpoint serves Apple's fixed 30-second preview. `trackToSong`
  // keeps the full recording length separately as `recordingDuration`.
  return trackToSong(item, 0, 30);
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

export async function GET(request: Request): Promise<NextResponse> {
  const chart = new URL(request.url).searchParams.get('chart') as ChartKey | null;
  if (!chart || !(chart in CHARTS)) return NextResponse.json({ error: 'Unknown chart' }, { status: 400 });
  // Bucketed per chart: exhausting the US chart must not lock a client out of
  // Japan's, which is a different feed and a different set of lookups.
  const limited = rateLimit(request, `charts:${chart}`);
  if (limited) return limited;
  const config = CHARTS[chart];

  try {
    const feedResponse = await fetch(
      `https://rss.marketingtools.apple.com/api/v2/${config.region}/music/most-played/${CHART_SIZE}/songs.json`,
      { next: { revalidate: 900 }, signal: upstreamSignal(request.signal) },
    );
    if (!feedResponse.ok) return NextResponse.json({ error: `${config.name} is unavailable` }, { status: 502 });
    const feed = (await feedResponse.json()) as { feed?: { results?: FeedEntry[] } };
    const ids = (feed.feed?.results ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string' && TRACK_ID.test(id));
    if (!ids.length) return NextResponse.json({ error: `${config.name} is unavailable` }, { status: 502 });

    const chunks: string[][] = [];
    for (let index = 0; index < ids.length; index += LOOKUP_CHUNK) {
      chunks.push(ids.slice(index, index + LOOKUP_CHUNK));
    }
    // A chunk that fails costs its own entries, not the whole chart.
    const settled = await Promise.allSettled(chunks.map((chunk) => lookupChunk(chunk, config.region, request.signal)));
    const byTrackId = new Map<string, Song>();
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      for (const item of result.value) {
        if (isPlayableTrack(item)) byTrackId.set(String(item.trackId), chartTrackToSong(item));
      }
    }

    // Chart position is the whole point, so the feed's order wins over the
    // order the lookup happened to return.
    const results = ids.map((id) => byTrackId.get(id)).filter((song): song is Song => song !== undefined);
    if (!results.length) {
      return NextResponse.json(
        { error: `${config.name} is unavailable`, provider: 'Apple Preview', unavailable: true },
        { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    return NextResponse.json(
      { name: config.name, results },
      {
        headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800' },
      },
    );
  } catch {
    return NextResponse.json(
      { error: `${config.name} is unavailable`, provider: 'Apple Preview', unavailable: true },
      { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
