import type { MusicProvider } from './types';
import { providerFetch } from './errors';
import { createDeterministicCover } from '@/lib/coverArt';
import type { Song } from '@/types/music';

const PROXY_BASE = '/api/music/kugou';
const HASH_RE = /^[a-f0-9]{32}$/;

export interface KugouSong {
  hash?: string;
  songname?: string;
  songname_original?: string;
  singername?: string;
  album_name?: string;
  album_id?: string | number;
  album_audio_id?: string | number;
  duration?: number | string;
  extname?: string;
  filesize?: number | string;
  bitrate?: number | string;
  pay_type?: number | string;
  privilege?: number | string;
  filename?: string;
}

interface KugouSearchResponse {
  results?: KugouSong[];
}

interface KugouProbeResponse {
  available?: boolean;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Kugou flags records that the player API will not resolve to a stream as
 * paid. Marking them up front keeps paid songs out of a queue that cannot play
 * and avoids a probe round-trip for records that always fail.
 */
function playbackUnavailable(item: KugouSong): boolean {
  const pay = Number(item.pay_type);
  const privilege = Number(item.privilege);
  return (Number.isFinite(pay) && pay >= 3) || (Number.isFinite(privilege) && privilege >= 10);
}

export function kugouSongToSong(item: KugouSong, index = 0): Song | null {
  const hash = text(item.hash);
  const title = text(item.songname) || text(item.songname_original);
  const artist = text(item.singername);
  if (!HASH_RE.test(hash) || !title || !artist) return null;

  const rawDuration = Number(item.duration);
  const duration = Number.isFinite(rawDuration) ? Math.max(0, Math.round(rawDuration)) : 0;
  const album = text(item.album_name) || title;
  const rawAlbumId = item.album_id;
  const albumId =
    rawAlbumId != null && String(rawAlbumId).trim() !== ''
      ? `kugou-album-${rawAlbumId}`
      : `kugou-album-${hash}`;
  const detailUrl = `https://www.kugou.com/song/#hash=${hash}`;
  const suffix = text(item.extname) || 'mp3';
  const size = Number(item.filesize) || 0;
  const bitRate = Number(item.bitrate) || 0;

  return {
    id: `kugou-${hash}`,
    title,
    artist,
    artistId: `kugou-artist-${hash}`,
    album,
    albumId,
    coverArt: createDeterministicCover(`${artist}:${album}`, 160),
    duration,
    track: index + 1,
    year: 0,
    genre: '',
    path: `${PROXY_BASE}/stream/${hash}`,
    bitRate,
    contentType: suffix === 'mp4' ? 'audio/mp4' : 'audio/mpeg',
    suffix,
    size,
    provider: 'Kugou',
    sourceUrl: detailUrl,
    creatorUrl: 'https://www.kugou.com/',
    licenseName: 'Source terms',
    licenseUrl: 'https://www.kugou.com/',
    attributionUrl: detailUrl,
    metadataVerified: true,
    ...(playbackUnavailable(item) ? { playbackUnavailable: true } : {}),
  };
}

function rawSongHash(song: Song): string | null {
  const value = song.id.startsWith('kugou-') ? song.id.slice('kugou-'.length) : '';
  return HASH_RE.test(value) ? value : null;
}

type KugouProvider = MusicProvider;

export const kugouProvider: KugouProvider = {
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
    const data = await providerFetch<KugouSearchResponse>(
      'Kugou',
      'search',
      `${PROXY_BASE}/tracks`,
      { q: query.trim(), limit: '40' },
      signal,
    );
    return (Array.isArray(data.results) ? data.results : [])
      .map((item, index) => kugouSongToSong(item, index))
      .filter((song): song is Song => song !== null);
  },

  async getStreamUrl(song: Song, signal?: AbortSignal): Promise<string> {
    const hash = rawSongHash(song);
    if (!hash || song.playbackUnavailable === true) throw new Error('Kugou stream is unavailable');
    const probe = await providerFetch<KugouProbeResponse>(
      'Kugou',
      'streamProbe',
      `${PROXY_BASE}/stream/${hash}`,
      { probe: '1', ...(song.duration > 45 ? { expected: String(song.duration) } : {}) },
      signal,
      { timeoutMs: 6_000 },
    );
    if (probe.available !== true) throw new Error('Kugou stream is unavailable');
    return song.path;
  },

  async getSongsByTag(tag: string, limit = 50, signal?: AbortSignal): Promise<Song[]> {
    return (await this.search(tag, signal)).slice(0, Math.max(0, Math.floor(limit)));
  },

  async getTrending(): Promise<never[]> {
    return [];
  },
};