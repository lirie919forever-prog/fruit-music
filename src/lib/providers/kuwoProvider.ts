'use client';

import type { MusicProvider } from './types';
import type { Song } from '@/types/music';
import { providerFetch } from './errors';
import { safeCoverArt } from '@/lib/coverArt';

const PROXY_BASE = '/api/music/kuwo';

/**
 * Kuwo (酷我音乐) search item, parsed from the single-quoted JSON that
 * `search.kuwo.cn/r.s` returns. Keys are uppercase; we read only the fields
 * the catalog needs.
 */
interface KuwoSearchItem {
  DC_TARGETID: string;
  NAME: string;
  ARTIST: string;
  ARTISTID: string;
  ALBUM: string;
  ALBUMID: string;
  DURATION: string;
  ARTISTPIC?: string;
}

interface KuwoSearchResponse {
  abslist?: KuwoSearchItem[];
  TOTAL?: string;
}

function mapKuwoSong(item: KuwoSearchItem): Song {
  const rawId = item.DC_TARGETID;
  const songId = `kuwo-${rawId}`;
  const artist = item.ARTIST || 'Unknown';
  const album = item.ALBUM || '';
  const duration = item.DURATION ? Math.round(Number(item.DURATION)) : 0;
  return {
    id: songId,
    title: item.NAME.replace(/&nbsp;/g, ' ').trim() || 'Unknown',
    artist,
    artistId: item.ARTISTID ? `kuwo-artist-${item.ARTISTID}` : songId,
    album,
    albumId: item.ALBUMID ? `kuwo-album-${item.ALBUMID}` : songId,
    coverArt: safeCoverArt(item.ARTISTPIC),
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

export const kuwoProvider: MusicProvider = {
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

  async search(query: string, signal?: AbortSignal): Promise<Song[]> {
    if (!query.trim()) return [];
    try {
      const data = await providerFetch<KuwoSearchResponse>(
        'Kuwo',
        'search',
        `${PROXY_BASE}/search`,
        { key: query.trim() },
        signal,
      );
      const list = Array.isArray(data.abslist) ? data.abslist : [];
      return list.map(mapKuwoSong).filter((song) => song.title !== 'Unknown');
    } catch (error) {
      return handleKuwoError(error, 'search');
    }
  },

  async getStreamUrl(song: Song): Promise<string> {
    return song.path;
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
