import { NextResponse } from 'next/server';
import { createRateLimiter } from '../music/rateLimit';
import { pickLyricsMatch, toLyricsResult } from '@/lib/lyrics/lrclib';

/**
 * Lyrics for the track that is playing, from LRCLIB.
 *
 * LRCLIB serves CORS-open JSON, so the browser could call it directly. It is
 * proxied anyway for three reasons that matter here: the response is cached
 * once for everyone instead of once per visitor, LRCLIB asks callers to
 * identify themselves in a `User-Agent` that a browser will not let a page set,
 * and every other upstream in this app is reached from the server, so keeping
 * one exception would mean one host outside the boundary the rest are inside.
 *
 * The matching itself lives in `@/lib/lyrics/lrclib` — deciding which of twenty
 * near-identical records is the song is the part worth testing on its own.
 */

const LRCLIB_SEARCH = 'https://lrclib.net/api/search';
const UPSTREAM_TIMEOUT_MS = 8_000;
/** LRCLIB asks clients to identify themselves and where to complain about them. */
const USER_AGENT = 'Marea/0.1.0 (https://github.com/lirie919forever-prog/fruit-music)';

/**
 * Long enough for any real title, short enough that the query string cannot be
 * used to push arbitrary bulk through this server at LRCLIB.
 */
const MAX_FIELD_LENGTH = 200;

/**
 * One upstream call per request, and a client makes one per track change.
 * Thirty a minute is a listener skipping every two seconds for a solid minute;
 * past that it is a loop, not a person.
 */
const rateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 30, maxEntries: 4_000 });

/**
 * Lyrics are the one thing in this app whose rights are neither the operator's
 * nor a Creative Commons licence's — see the README. An operator who does not
 * want them served can turn the route off without a rebuild.
 */
function lyricsEnabled(): boolean {
  return process.env.LYRICS_ENABLED !== 'false';
}

function field(params: URLSearchParams, name: string): string | null {
  const raw = params.get(name);
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === '' || trimmed.length > MAX_FIELD_LENGTH ? null : trimmed;
}

/**
 * A miss is cached too, and for as long as a hit. The alternative is that every
 * Creative Commons track — none of which LRCLIB has ever heard of, and which
 * are most of this catalog — sends a request upstream on every single play.
 */
const CACHE_HEADERS = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' };

export async function GET(request: Request): Promise<NextResponse> {
  if (!lyricsEnabled()) {
    return NextResponse.json({ found: false, reason: 'disabled' }, { status: 200, headers: CACHE_HEADERS });
  }

  const params = new URL(request.url).searchParams;
  const track = field(params, 'track');
  const artist = field(params, 'artist');
  if (!track || !artist) {
    return NextResponse.json({ error: 'track and artist are required' }, { status: 400 });
  }
  const album = field(params, 'album') ?? undefined;
  const rawDuration = Number(params.get('duration'));
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : undefined;

  const limited = rateLimit(request, 'lyrics');
  if (limited) return limited;

  const upstream = new URL(LRCLIB_SEARCH);
  upstream.searchParams.set('track_name', track);
  upstream.searchParams.set('artist_name', artist);

  try {
    const response = await fetch(upstream, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      // Lyrics for a released recording do not change. A day is short enough
      // that a correction upstream reaches listeners within one, and long
      // enough that a popular track costs LRCLIB one request a day rather than
      // one per listener.
      next: { revalidate: 86_400 },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    });
    // 404 is LRCLIB's ordinary "no such track", not a failure of this server.
    if (response.status === 404) {
      return NextResponse.json({ found: false }, { status: 200, headers: CACHE_HEADERS });
    }
    if (!response.ok) {
      return NextResponse.json({ found: false, reason: 'unavailable' }, { status: 502 });
    }

    const match = pickLyricsMatch(await response.json(), { track, artist, album, duration });
    if (!match) {
      return NextResponse.json({ found: false }, { status: 200, headers: CACHE_HEADERS });
    }
    return NextResponse.json({ found: true, lyrics: toLyricsResult(match) }, { status: 200, headers: CACHE_HEADERS });
  } catch {
    // A timeout, a network fault or a body that is not JSON. None of them is a
    // statement about whether the lyrics exist, so none of them is cached.
    return NextResponse.json({ found: false, reason: 'unavailable' }, { status: 502 });
  }
}
