'use client';

import type { MusicProvider } from './types';
import type { Song } from '@/types/music';
import { providerFetch } from './errors';
import { createDeterministicCover, safeCoverArt } from '@/lib/coverArt';
import { repairUtf8Mojibake } from '@/lib/repairUtf8Mojibake';

const PROXY_BASE = '/api/music/kuwo';

/**
 * Kuwo (酷我音乐) search item, parsed from the single-quoted JSON that
 * `search.kuwo.cn/r.s` returns. Keys are uppercase; we read only the fields
 * the catalog needs.
 */
interface KuwoSearchItem {
  DC_TARGETID: string;
  NAME: string;
  SONGNAME?: string;
  ARTIST: string;
  ARTISTID: string;
  ALBUM: string;
  ALBUMID: string;
  DURATION: string;
  ARTISTPIC?: string;
  web_albumpic_short?: string;
}

interface KuwoSearchResponse {
  abslist?: KuwoSearchItem[];
  TOTAL?: string;
}

export interface KuwoSearchOptions {
  /** Background exact-match hydration should degrade without a noisy 502. */
  soft?: boolean;
}

interface KuwoProbeResponse {
  available?: boolean;
  bitrate?: '128kmp3' | '192kmp3' | '320kmp3';
}

function decodeKuwoText(value: string | undefined): string {
  if (!value) return '';
  return repairUtf8Mojibake(
    value
      .replace(/\\u([0-9a-f]{4})/gi, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
      .replace(/\\([&'"\\])/g, '$1')
      .replace(/&nbsp;|&amp;|&quot;|&apos;|&#39;|&#x27;/gi, (entity) => {
        const normalized = entity.toLowerCase();
        if (normalized === '&nbsp;') return ' ';
        if (normalized === '&amp;') return '&';
        if (normalized === '&quot;') return '"';
        return "'";
      })
      .replace(/&#(x[0-9a-f]+|\d+);/gi, (_entity, code: string) => {
        const value = code.toLowerCase().startsWith('x') ? Number.parseInt(code.slice(1), 16) : Number(code);
        return Number.isSafeInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
      })
      .trim(),
  );
}

const KUWO_ARTWORK_PATH = /^[a-z0-9/_-]+\.jpg$/i;

function kuwoCoverArt(item: KuwoSearchItem, seed: string): string {
  const albumPath = item.web_albumpic_short?.trim().replace(/^\/+/, '');
  if (albumPath && !albumPath.includes('..') && KUWO_ARTWORK_PATH.test(albumPath)) {
    const remote = safeCoverArt(`https://img1.kuwo.cn/star/albumcover/${albumPath}`);
    if (remote !== '/placeholder-album.svg') return remote;
  }

  // Some Kuwo hits have no public image path at all. A stable generated cover
  // keeps those rows identifiable without rendering a dark generic placeholder.
  return createDeterministicCover(seed, 32);
}

function mapKuwoSong(item: KuwoSearchItem): Song {
  const rawId = item.DC_TARGETID;
  const songId = `kuwo-${rawId}`;
  // SONGNAME carries version labels that NAME sometimes drops (for example
  // cover, live, and trial recordings). Keep that context so matching cannot
  // silently promote an alternate recording as the studio track.
  const title = decodeKuwoText(item.SONGNAME || item.NAME);
  const artist = decodeKuwoText(item.ARTIST) || 'Unknown';
  const album = decodeKuwoText(item.ALBUM);
  const rawDuration = Number(item.DURATION);
  const duration = Number.isFinite(rawDuration) ? Math.max(0, Math.round(rawDuration)) : 0;
  return {
    id: songId,
    title: title || 'Unknown',
    artist,
    artistId: item.ARTISTID ? `kuwo-artist-${item.ARTISTID}` : songId,
    album,
    albumId: item.ALBUMID ? `kuwo-album-${item.ALBUMID}` : songId,
    coverArt: kuwoCoverArt(item, `${artist}:${album || title}`),
    duration,
    track: 0,
    year: 0,
    genre: '',
    path: `${PROXY_BASE}/url?rid=${encodeURIComponent(rawId)}&br=320kmp3`,
    bitRate: 320,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: 0,
    provider: 'Kuwo',
    sourceUrl: '',
    creatorUrl: '',
    licenseName: 'Source terms',
    licenseUrl: '',
    attributionUrl: '',
    metadataVerified: false,
  };
}

function handleKuwoError(error: unknown, operation: string): never {
  if (error instanceof DOMException && error.name === 'AbortError') throw error;
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`Kuwo ${operation}: ${message}`);
}

function pathAtBitrate(path: string, bitrate: KuwoProbeResponse['bitrate']): string {
  if (!bitrate) return path;
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const url = new URL(path, origin);
  url.searchParams.set('br', bitrate);
  return `${url.pathname}${url.search}`;
}

export async function searchKuwo(query: string, signal?: AbortSignal, options?: KuwoSearchOptions): Promise<Song[]> {
  if (!query.trim()) return [];
  try {
    const data = await providerFetch<KuwoSearchResponse>(
      'Kuwo',
      'search',
      `${PROXY_BASE}/search`,
      { key: query.trim(), ...(options?.soft ? { soft: '1' } : {}) },
      signal,
    );
    const list = Array.isArray(data.abslist) ? data.abslist : [];
    return list.map(mapKuwoSong).filter((song) => song.title !== 'Unknown');
  } catch (error) {
    return handleKuwoError(error, 'search');
  }
}

type KuwoProvider = MusicProvider & {
  search(query: string, signal?: AbortSignal, options?: KuwoSearchOptions): Promise<Song[]>;
};

export const kuwoProvider: KuwoProvider = {
  async getAlbums(): Promise<never[]> {
    return [];
  },

  async getArtists(): Promise<never[]> {
    return [];
  },

  async getAlbumSongs(): Promise<never[]> {
    return [];
  },

  async getArtistSongs(): Promise<never[]> {
    return [];
  },

  async search(query: string, signal?: AbortSignal, options?: KuwoSearchOptions): Promise<Song[]> {
    return searchKuwo(query, signal, options);
  },

  async getStreamUrl(song: Song, signal?: AbortSignal): Promise<string> {
    const probe = await providerFetch<KuwoProbeResponse>(
      'Kuwo',
      'streamProbe',
      song.path,
      {
        probe: '1',
        ...(song.duration > 45 ? { expected: String(song.duration) } : {}),
      },
      signal,
      { timeoutMs: 6_000 },
    );
    if (probe.available !== true) throw new Error('Kuwo stream is unavailable');
    return pathAtBitrate(song.path, probe.bitrate);
  },

  async getSongsByTag(tag: string, limit = 200, signal?: AbortSignal): Promise<Song[]> {
    if (!tag.trim()) return [];
    try {
      const results = await kuwoProvider.search(tag, signal);
      return results.slice(0, limit);
    } catch (error) {
      return handleKuwoError(error, 'tagSearch');
    }
  },

  async getTrending(limit = 50, signal?: AbortSignal): Promise<Song[]> {
    const popularQueries = ['热歌', '飙升', '流行'];
    for (const query of popularQueries) {
      try {
        const results = await kuwoProvider.search(query, signal);
        if (results.length > 0) return results.slice(0, limit);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
      }
    }
    return [];
  },
};
