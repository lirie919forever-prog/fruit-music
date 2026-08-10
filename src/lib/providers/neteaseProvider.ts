import type { MusicProvider } from './types';
import { providerFetch } from './errors';
import { createDeterministicCover, safeCoverArt } from '@/lib/coverArt';
import type { Song } from '@/types/music';

const PROXY_BASE = '/api/music/netease';
const NETEASE_TERMS_URL = 'https://music.163.com/';
const SONG_ID_PATTERN = /^d{1,20}$/;

interface NeteaseArtist {
  name?: string;
  id?: number;
}

interface NeteaseAlbum {
  name?: string;
  id?: number;
  picUrl?: string;
}

interface NeteaseSearchSong {
  id?: number;
  name?: string;
  duration?: number;
  artists?: NeteaseArtist[];
  album?: NeteaseAlbum;
}

interface NeteaseSearchResponse {
  result?: {
    songs?: NeteaseSearchSong[];
  };
  code?: number;
}

interface NeteaseStreamResponse {
  available?: boolean;
}

function resolveArtists(artists: NeteaseArtist[] | undefined): string {
  if (!Array.isArray(artists) || artists.length === 0) return 'Unknown artist';
  return artists.map((a) => a.name || '').filter(Boolean).join(', ') || 'Unknown artist';
}

function safeNeteaseArtwork(picUrl: string | undefined, seed: string): string {
  const cover = safeCoverArt(picUrl);
  return cover === '/placeholder-album.svg' ? createDeterministicCover(seed, 194) : cover;
}

export function neteaseItemToSong(item: NeteaseSearchSong, index = 0): Song | null {
  const songId = String(item.id ?? '').trim();
  const title = item.name?.trim() || '';
  const artist = resolveArtists(item.artists);
  const albumName = item.album?.name?.trim() || title;
  const albumId = String(item.album?.id ?? songId);
  const duration = Math.round((item.duration ?? 0) / 1000);
  if (!SONG_ID_PATTERN.test(songId) || !title || duration < 30) return null;

  const sourceUrl = `https://music.163.com/song?id=${songId}`;
  return {
    id: `netease-${songId}`,
    title,
    artist,
    artistId: `netease-artist-${String(item.artists?.[0]?.id ?? songId)}`,
    album: albumName,
    albumId: `netease-album-${albumId}`,
    coverArt: safeNeteaseArtwork(item.album?.picUrl, `${artist}:${title}`),
    duration,
    track: index + 1,
    year: 0,
    genre: '',
    path: `${PROXY_BASE}/stream/${songId}`,
    bitRate: 0,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: 0,
    provider: 'Netease',
    sourceUrl,
    creatorUrl: item.artists?.[0]?.id
      ? `https://music.163.com/artist?id=${item.artists[0].id}`
      : 'https://music.163.com/',
    licenseName: 'Platform terms',
    licenseUrl: NETEASE_TERMS_URL,
    attributionUrl: sourceUrl,
    metadataVerified: false,
  };
}

function rawId(song: Song): string | null {
  const value = song.id.startsWith('netease-') ? song.id.slice('netease-'.length) : '';
  return SONG_ID_PATTERN.test(value) ? value : null;
}

export const neteaseProvider: MusicProvider = {
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
    const data = await providerFetch<NeteaseSearchResponse>(
      'Netease',
      'search',
      `${PROXY_BASE}/tracks`,
      { q: query.trim(), limit: '40' },
      signal,
      { timeoutMs: 12_000 },
    );
    return (Array.isArray(data.result?.songs) ? data.result.songs : [])
      .map((item, index) => neteaseItemToSong(item, index))
      .filter((song): song is Song => song !== null);
  },

  async getStreamUrl(song: Song, signal?: AbortSignal): Promise<string> {
    const songId = rawId(song);
    if (!songId || song.playbackUnavailable === true) throw new Error('Netease stream is unavailable');
    const probe = await providerFetch<NeteaseStreamResponse>(
      'Netease',
      'streamProbe',
      `${PROXY_BASE}/stream/${songId}`,
      { probe: '1', ...(song.duration > 45 ? { expected: String(song.duration) } : {}) },
      signal,
      { timeoutMs: 12_000 },
    );
    if (probe.available !== true) throw new Error('Netease stream is unavailable');
    return song.path;
  },

  async getSongsByTag(tag: string, limit = 40, signal?: AbortSignal): Promise<Song[]> {
    return (await this.search(tag, signal)).slice(0, Math.max(0, Math.floor(limit)));
  },

  async getTrending(): Promise<never[]> {
    return [];
  },
};
