'use client';

import type { MusicProvider } from './types';
import { providerFetch } from './errors';
import type { Album, Artist, Song } from '@/types/music';
import { safeCoverArt } from '@/lib/coverArt';

const PROXY_BASE = '/api/music/lxmusic';

const DEFAULT_LEVEL = '320';

interface LxSearchResult {
  id?: number | string;
  name?: string;
  ar?: Array<{ name?: string; id?: number | string }>;
  al?: {
    name?: string;
    picUrl?: string;
    id?: number | string;
  };
  dt?: number;
  platform?: string;
  type?: number;
  privilege?: { level?: number };
}

interface LxSearchResponse {
  code?: number;
  data?: {
    total?: number;
    result?: LxSearchResult[];
  };
  msg?: string;
}

function mapLxSong(item: LxSearchResult, level: string): Song {
  const platform = item.platform || 'wy';
  const rawId = String(item.id ?? '');
  const songId = `lxmusic-${platform}_${item.type ?? 1}_${rawId}`;

  const title = item.name || 'Unknown';
  const artist = item.ar?.[0]?.name
    ? item.ar.map((a) => a.name || 'Unknown').join(' / ')
    : 'Unknown';
  const album = item.al?.name || 'Unknown';
  const coverArt = safeCoverArt(item.al?.picUrl);
  const duration = typeof item.dt === 'number' && Number.isFinite(item.dt) ? Math.max(0, Math.round(item.dt / 1000)) : 0;

  const artistId = item.ar?.[0]?.id != null
    ? `lxmusic-artist-${platform}_${item.ar[0].id}`
    : `lxmusic-artist-${platform}_unknown`;
  const albumId = `lxmusic-album-${platform}_${item.al?.id ?? rawId}`;

  const lxLevel = item.privilege?.level ? String(item.privilege.level) : level;

  return {
    id: songId,
    title,
    artist,
    artistId,
    album,
    albumId,
    coverArt,
    duration,
    track: 0,
    year: 0,
    genre: '',
    path: `${PROXY_BASE}/url?id=${encodeURIComponent(songId)}&level=${encodeURIComponent(lxLevel)}&platform=${encodeURIComponent(platform)}&rawId=${encodeURIComponent(rawId)}&type=${encodeURIComponent(String(item.type ?? 1))}`,
    bitRate: lxLevel === '320' ? 320 : lxLevel === '128' ? 128 : 0,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: 0,
    provider: 'LX Music',
    sourceUrl: '',
    creatorUrl: '',
    licenseName: 'Source terms',
    licenseUrl: '',
    attributionUrl: '',
    metadataVerified: false,
  };
}

function handleLxError(error: unknown, operation: string): never {
  if (error instanceof DOMException && error.name === 'AbortError') throw error;
  const message = error instanceof Error ? error.message : 'LX Music request failed';
  throw new Error(`LX Music ${operation}: ${message}`);
}

export const lxmusicProvider: MusicProvider = {
  async getAlbums(): Promise<Album[]> {
    return [];
  },

  async getArtists(): Promise<Artist[]> {
    return [];
  },

  async getAlbumSongs(): Promise<Song[]> {
    return [];
  },

  async getArtistSongs(): Promise<Song[]> {
    return [];
  },

  async search(query: string, signal?: AbortSignal): Promise<Song[]> {
    if (!query.trim()) return [];
    try {
      const data = await providerFetch<LxSearchResponse>('LX Music', 'search', `${PROXY_BASE}/search`, {
        key: query.trim(),
        type: '1',
      }, signal);

      if (data.code !== 0 && data.code !== 200) {
        const msg = (data as Record<string, unknown>).msg ?? (data as Record<string, unknown>).message;
        if (typeof msg === 'string' && msg.includes('未知')) return [];
        return [];
      }
      const results = data.data?.result;
      if (!Array.isArray(results)) return [];
      const level = process.env.NEXT_PUBLIC_LX_DEFAULT_LEVEL || DEFAULT_LEVEL;
      return results.map((item) => mapLxSong(item, level));
    } catch (error) {
      return handleLxError(error, 'search');
    }
  },

  async getStreamUrl(song: Song): Promise<string> {
    return song.path;
  },

  async getSongsByTag(tag: string, limit = 200, signal?: AbortSignal): Promise<Song[]> {
    if (!tag.trim()) return [];
    try {
      const data = await providerFetch<LxSearchResponse>('LX Music', 'tagSearch', `${PROXY_BASE}/search`, {
        key: tag.trim(),
        type: '1',
      }, signal);
      if (data.code !== 0 && data.code !== 200) return [];
      const results = data.data?.result;
      if (!Array.isArray(results)) return [];
      const level = process.env.NEXT_PUBLIC_LX_DEFAULT_LEVEL || DEFAULT_LEVEL;
      return results.map((item) => mapLxSong(item, level)).slice(0, limit);
    } catch (error) {
      return handleLxError(error, 'tagSearch');
    }
  },

  async getTrending(limit = 50, signal?: AbortSignal): Promise<Song[]> {
    const popularQueries = ['热门', '热歌', '飙升'];
    for (const q of popularQueries) {
      try {
        const data = await providerFetch<LxSearchResponse>('LX Music', 'trending', `${PROXY_BASE}/search`, {
          key: q,
          type: '1',
        }, signal);
        if (data.code !== 0 && data.code !== 200) continue;
        const results = data.data?.result;
        if (!Array.isArray(results) || results.length === 0) continue;
        const level = process.env.NEXT_PUBLIC_LX_DEFAULT_LEVEL || DEFAULT_LEVEL;
        const songs = results.map((item) => mapLxSong(item, level));
        return songs.slice(0, limit);
      } catch {
        continue;
      }
    }
    return [];
  },
};
