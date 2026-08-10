import type { MusicProvider } from './types';
import { providerFetch } from './errors';
import { createDeterministicCover, safeCoverArt } from '@/lib/coverArt';
import type { Song } from '@/types/music';

const PROXY_BASE = '/api/music/qq';
const SONG_MID = /^[A-Za-z0-9]{8,32}$/;
const ALBUM_MID = /^[A-Za-z0-9]{8,32}$/;

interface QQSinger {
  id?: number;
  mid?: string;
  name?: string;
}

interface QQPayInfo {
  payplay?: number;
}

export interface QQMusicSong {
  songmid?: string;
  songid?: number;
  songname?: string;
  singer?: QQSinger[];
  albumid?: number;
  albummid?: string;
  albumname?: string;
  interval?: number;
  pubtime?: number;
  stream?: number;
  pay?: QQPayInfo;
}

interface QQMusicSearchResponse {
  results?: QQMusicSong[];
}

interface QQMusicProbeResponse {
  available?: boolean;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validSongMid(value: unknown): value is string {
  return typeof value === 'string' && SONG_MID.test(value);
}

function releaseYear(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  const year = new Date(value * 1000).getUTCFullYear();
  return Number.isFinite(year) && year >= 1900 && year <= 2100 ? year : 0;
}

function artistText(singers: QQSinger[] | undefined): string {
  if (!Array.isArray(singers)) return '';
  return singers
    .map((singer) => text(singer.name))
    .filter(Boolean)
    .join(', ');
}

function artistId(singers: QQSinger[] | undefined, songMid: string): string {
  const singer = singers?.find((candidate) => validSongMid(candidate.mid) || Number.isSafeInteger(candidate.id));
  if (validSongMid(singer?.mid)) return `qq-artist-${singer.mid}`;
  if (Number.isSafeInteger(singer?.id) && singer!.id! > 0) return `qq-artist-${singer!.id}`;
  return `qq-artist-${songMid}`;
}

function coverArt(item: QQMusicSong, seed: string): string {
  const albumMid = text(item.albummid);
  if (ALBUM_MID.test(albumMid)) {
    // QQ publishes 150, 300, 500, and 800 pixel variants, but not 600px.
    // Asking for 600px produces a 404 for otherwise valid album IDs.
    return safeCoverArt(`https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg`);
  }
  return createDeterministicCover(seed, 160);
}

/**
 * QQ Music's search result distinguishes records that are explicitly paid from
 * records that may expose a public signed URL. The latter still need a probe
 * before playback, while the former never enter a queue that cannot play.
 */
function playbackUnavailable(item: QQMusicSong): boolean {
  return item.pay?.payplay === 1 || item.stream === 0;
}

export function qqMusicSongToSong(item: QQMusicSong, index = 0): Song | null {
  const songMid = text(item.songmid);
  const title = text(item.songname);
  const artist = artistText(item.singer);
  if (!SONG_MID.test(songMid) || !title || !artist) return null;

  const rawDuration = Number(item.interval);
  const duration = Number.isFinite(rawDuration) ? Math.max(0, Math.round(rawDuration)) : 0;
  const album = text(item.albumname) || title;
  const rawAlbumId = Number(item.albumid);
  const albumId = Number.isSafeInteger(rawAlbumId) && rawAlbumId > 0 ? `qq-album-${rawAlbumId}` : `qq-album-${songMid}`;
  const detailUrl = `https://y.qq.com/n/ryqq/songDetail/${songMid}`;

  return {
    id: `qq-${songMid}`,
    title,
    artist,
    artistId: artistId(item.singer, songMid),
    album,
    albumId,
    coverArt: coverArt(item, `${artist}:${album}`),
    duration,
    track: index + 1,
    year: releaseYear(item.pubtime),
    genre: '',
    path: `${PROXY_BASE}/stream/${songMid}`,
    bitRate: 0,
    contentType: 'audio/mp4',
    suffix: 'm4a',
    size: 0,
    provider: 'QQ Music',
    sourceUrl: detailUrl,
    creatorUrl: 'https://y.qq.com/',
    licenseName: 'Source terms',
    licenseUrl: 'https://y.qq.com/',
    attributionUrl: detailUrl,
    metadataVerified: true,
    ...(playbackUnavailable(item) ? { playbackUnavailable: true } : {}),
  };
}

function rawSongMid(song: Song): string | null {
  const value = song.id.startsWith('qq-') ? song.id.slice('qq-'.length) : '';
  return SONG_MID.test(value) ? value : null;
}

type QQMusicProvider = MusicProvider;

export const qqMusicProvider: QQMusicProvider = {
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
    const data = await providerFetch<QQMusicSearchResponse>(
      'QQ Music',
      'search',
      `${PROXY_BASE}/tracks`,
      { q: query.trim(), limit: '40' },
      signal,
    );
    return (Array.isArray(data.results) ? data.results : [])
      .map((item, index) => qqMusicSongToSong(item, index))
      .filter((song): song is Song => song !== null);
  },

  async getStreamUrl(song: Song, signal?: AbortSignal): Promise<string> {
    const songMid = rawSongMid(song);
    if (!songMid || song.playbackUnavailable === true) throw new Error('QQ Music stream is unavailable');
    const probe = await providerFetch<QQMusicProbeResponse>(
      'QQ Music',
      'streamProbe',
      `${PROXY_BASE}/stream/${songMid}`,
      { probe: '1', ...(song.duration > 45 ? { expected: String(song.duration) } : {}) },
      signal,
      { timeoutMs: 6_000 },
    );
    if (probe.available !== true) throw new Error('QQ Music stream is unavailable');
    return song.path;
  },

  async getSongsByTag(tag: string, limit = 50, signal?: AbortSignal): Promise<Song[]> {
    return (await this.search(tag, signal)).slice(0, Math.max(0, Math.floor(limit)));
  },

  async getTrending(): Promise<never[]> {
    return [];
  },
};
