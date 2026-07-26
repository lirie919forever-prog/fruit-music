import { NextResponse } from 'next/server';
import { safeCoverArt } from '@/lib/coverArt';

const CHARTS = {
  billboard: { region: 'us', name: 'Apple US Top Songs' },
  uk: { region: 'gb', name: 'UK Top Songs' },
  jp: { region: 'jp', name: 'J-Pop' },
} as const;

const LX_API_BASE = process.env.LX_API_BASE;
const LX_RESOLVER_BASE = process.env.LX_RESOLVER_BASE;
const LX_APPROVED_MEDIA_HOSTS = new Set(
  (process.env.LX_APPROVED_MEDIA_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
);
const LX_REQUEST_KEY = 'share-v3';
const CHART_LOOKUP_CONCURRENCY = 5;
const UPSTREAM_TIMEOUT_MS = 8_000;

function configuredBase(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function approvedResolverUrl(value: string, base: string): boolean {
  try {
    const url = new URL(value);
    const baseHost = new URL(base).hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && (url.hostname.toLowerCase() === baseHost || LX_APPROVED_MEDIA_HOSTS.has(url.hostname.toLowerCase()));
  } catch {
    return false;
  }
}

function unavailableResponse(message: string): NextResponse {
  return NextResponse.json(
    { error: message, provider: 'LX Music', unavailable: true },
    { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
  );
}

function upstreamSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function hasResolvableTrack(rawId: string, signal?: AbortSignal): Promise<boolean> {
  const base = configuredBase(LX_RESOLVER_BASE) || configuredBase(LX_API_BASE);
  if (!base || !/^[A-Za-z0-9_-]{1,100}$/.test(rawId)) return false;
  try {
    const response = await fetch(`${base}/url/wy/${encodeURIComponent(rawId)}/320`, {
      headers: { 'X-Request-Key': LX_REQUEST_KEY, 'User-Agent': 'fruit-music/1.0' },
      signal: upstreamSignal(signal),
    });
    if (!response.ok) return false;
    const data = await response.json() as { url?: string; data?: Array<{ url?: string }> };
    const resolvedUrl = data.url || data.data?.[0]?.url;
    return typeof resolvedUrl === 'string' && approvedResolverUrl(resolvedUrl, base);
  } catch {
    return false;
  }
}

type ChartKey = keyof typeof CHARTS;

interface AppleSong {
  id?: string;
  name?: string;
  artistName?: string;
  albumName?: string;
  artworkUrl100?: string;
  releaseDate?: string;
}

interface VkeysResult {
  id?: number | string;
  song?: string;
  singer?: string;
  album?: string;
  cover?: string;
}

function normalize(value: string | undefined): string {
  return (value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[（(].*?[）)]/g, ' ')
    .replace(/[\[【].*?[\]】]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function similarity(expected: string, actual: string): number {
  if (!expected || !actual) return 0;
  if (expected === actual) return 1;
  if (expected.includes(actual) || actual.includes(expected)) return 0.8;
  return 0;
}

function selectVkeysMatch(item: AppleSong, candidates: VkeysResult[]): VkeysResult | null {
  const expectedTitle = normalize(item.name);
  const expectedArtist = normalize(item.artistName);
  const ranked = candidates
    .filter((candidate) => candidate.id && candidate.song && candidate.singer)
    .map((candidate) => ({
      candidate,
      title: similarity(expectedTitle, normalize(candidate.song)),
      artist: similarity(expectedArtist, normalize(candidate.singer)),
    }))
    .filter(({ title, artist }) => title >= 0.8 && artist >= 0.8)
    .sort((a, b) => (b.title + b.artist) - (a.title + a.artist));
  if (!ranked.length) return null;
  const best = ranked[0];
  const next = ranked[1];
  if (next && best.title + best.artist - (next.title + next.artist) < 0.2) return null;
  return best.candidate;
}

function chartSong(item: AppleSong, match: VkeysResult, region: string, playbackUnavailable = false): Record<string, unknown> {
  const rawId = String(match.id ?? item.id ?? '');
  const artist = match.singer || item.artistName || 'Unknown';
  const cover = match.cover?.startsWith('https://') && new URL(match.cover).hostname === 'is1-ssl.mzstatic.com'
    ? match.cover
    : item.artworkUrl100;
  return {
    id: `lxmusic-wy_1_${rawId}`,
    title: match.song || item.name || 'Unknown',
    artist,
    artistId: `lxmusic-artist-wy_${rawId}`,
    album: match.album || item.albumName || 'Unknown',
    albumId: `lxmusic-album-wy_${rawId}`,
    coverArt: safeCoverArt(cover),
    duration: 0,
    track: 0,
    year: item.releaseDate ? Number(item.releaseDate.slice(0, 4)) || 0 : 0,
    genre: '',
    path: `/api/music/lxmusic/url?id=${encodeURIComponent(`lxmusic-wy_1_${rawId}`)}&level=320&platform=wy&rawId=${encodeURIComponent(rawId)}&type=1`,
    bitRate: 320,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: 0,
    provider: 'LX Music',
    sourceUrl: `https://music.apple.com/${region}/song/${item.id ?? rawId}`,
    creatorUrl: '',
    licenseName: 'Provider terms apply',
    licenseUrl: '',
    attributionUrl: `https://music.apple.com/${region}/song/${item.id ?? rawId}`,
    metadataVerified: false,
    playbackUnavailable,
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  if (process.env.NEXT_PUBLIC_LX_ENABLED !== 'true') {
    return NextResponse.json(
      { error: 'LX Music is disabled', provider: 'LX Music', unavailable: true },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const chart = new URL(request.url).searchParams.get('chart') as ChartKey | null;
  if (!chart || !(chart in CHARTS)) return NextResponse.json({ error: 'Unknown chart' }, { status: 400 });

  const config = CHARTS[chart];
  const resolverBase = configuredBase(LX_RESOLVER_BASE) || configuredBase(LX_API_BASE);
  if (!resolverBase) {
    return unavailableResponse(`${config.name} playback source unavailable`);
  }
  try {
    const feedResponse = await fetch(`https://rss.applemarketingtools.com/api/v2/${config.region}/music/most-played/50/songs.json`, {
      next: { revalidate: 900 },
      signal: upstreamSignal(request.signal),
    });
    if (!feedResponse.ok) return NextResponse.json({ error: `${config.name} chart unavailable` }, { status: 502 });
    const feed = await feedResponse.json() as { feed?: { results?: AppleSong[] } };
    const songs = (feed.feed?.results ?? []).slice(0, 30);
    const resolved = await mapConcurrent(songs, CHART_LOOKUP_CONCURRENCY, async (item) => {
      if (!item.name) return null;
      try {
        const response = await fetch(`https://api.vkeys.cn/v2/music/netease?word=${encodeURIComponent(`${item.name} ${item.artistName ?? ''}`)}`, {
          headers: { 'User-Agent': 'fruit-music/1.0' },
          next: { revalidate: 900 },
          signal: upstreamSignal(request.signal),
        });
        if (!response.ok) return null;
        const data = await response.json() as { data?: VkeysResult[] };
        const match = selectVkeysMatch(item, data.data ?? []);
        if (!match?.id) return null;
        const playbackAvailable = await hasResolvableTrack(String(match.id), request.signal);
        return chartSong(item, match, config.region, !playbackAvailable);
      } catch {
        return null;
      }
    });
    const results = resolved.filter(Boolean);
    if (!results.length) {
      return NextResponse.json(
        { error: `${config.name} playback source unavailable`, provider: 'LX Music', unavailable: true },
        { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    return NextResponse.json({ name: config.name, results }, {
      headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800' },
    });
  } catch {
    return unavailableResponse(`${config.name} playback source unavailable`);
  }
}
