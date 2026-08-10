import type { MusicProvider } from './types';
import { providerFetch } from './errors';
import { createDeterministicCover, safeCoverArt } from '@/lib/coverArt';
import type { Song } from '@/types/music';

const PROXY_BASE = '/api/music/bilibili';
const BILIBILI_TERMS_URL = 'https://www.bilibili.com/';
const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;

interface BilibiliSearchItem {
  bvid?: string;
  title?: string;
  author?: string;
  duration?: string;
  pic?: string;
  mid?: number | string;
  typename?: string;
  is_pay?: number;
}

interface BilibiliSearchResponse {
  results?: BilibiliSearchItem[];
}

const EXCLUDED_TITLE_MARKERS = [
  'cover',
  'remix',
  'live',
  'concert',
  'karaoke',
  'instrumental',
  'dance practice',
  'dance cover',
  'sped up',
  'slowed',
  'nightcore',
  'short clip',
  'preview',
  'teaser',
  'reaction',
  'tutorial',
  'guitar',
  'piano',
  'bass',
  'drum',
  'acapella',
  'karaoke',
  'mashup',
  'compilation',
];

function decodeHtmlText(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|#160);/gi, ' ')
    .replace(/&(?:amp|#38);/gi, '&')
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:apos|#39|#x27);/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => {
      const point = Number.parseInt(code, 16);
      return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const point = Number.parseInt(code, 10);
      return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseBilibiliDuration(value: string | undefined): number {
  if (!value) return 0;
  const parts = value
    .split(':')
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));
  if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1]);
  if (parts.length === 3) return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
  return 0;
}

function isExcludedTitle(title: string): boolean {
  const normalized = title.toLocaleLowerCase();
  return EXCLUDED_TITLE_MARKERS.some((marker) => normalized.includes(marker));
}

function safeBilibiliArtwork(value: string | undefined, seed: string): string {
  const remote = value?.startsWith('//') ? `https:${value}` : value;
  const cover = safeCoverArt(remote);
  return cover === '/placeholder-album.svg' ? createDeterministicCover(seed, 204) : cover;
}

function artistId(item: BilibiliSearchItem, bvid: string): string {
  const mid = String(item.mid ?? '').trim();
  return /^\d{1,20}$/.test(mid) ? `bilibili-artist-${mid}` : `bilibili-artist-${bvid}`;
}

export function bilibiliItemToSong(item: BilibiliSearchItem, index = 0): Song | null {
  const bvid = item.bvid?.trim() || '';
  const title = decodeHtmlText(item.title);
  const artist = decodeHtmlText(item.author);
  const duration = parseBilibiliDuration(item.duration);
  if (!BVID_PATTERN.test(bvid) || !title || !artist || duration < 45 || isExcludedTitle(title)) return null;

  const sourceUrl = `https://www.bilibili.com/video/${bvid}`;
  return {
    id: `bilibili-${bvid}`,
    title,
    artist,
    artistId: artistId(item, bvid),
    album: title,
    albumId: `bilibili-album-${bvid}`,
    coverArt: safeBilibiliArtwork(item.pic, `${artist}:${title}`),
    duration,
    track: index + 1,
    year: 0,
    genre: item.typename || '',
    path: `${PROXY_BASE}/stream/${bvid}`,
    bitRate: 0,
    contentType: 'audio/mp4',
    suffix: 'm4a',
    size: 0,
    provider: 'Bilibili',
    sourceUrl,
    creatorUrl: /^\d{1,20}$/.test(String(item.mid ?? ''))
      ? `https://space.bilibili.com/${String(item.mid)}`
      : 'https://www.bilibili.com/',
    licenseName: 'Platform terms',
    licenseUrl: BILIBILI_TERMS_URL,
    attributionUrl: sourceUrl,
    metadataVerified: false,
    ...(item.is_pay === 1 ? { playbackUnavailable: true } : {}),
  };
}

function rawBvid(song: Song): string | null {
  const value = song.id.startsWith('bilibili-') ? song.id.slice('bilibili-'.length) : '';
  return BVID_PATTERN.test(value) ? value : null;
}

export const bilibiliProvider: MusicProvider = {
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
    const data = await providerFetch<BilibiliSearchResponse>(
      'Bilibili',
      'search',
      `${PROXY_BASE}/tracks`,
      { q: query.trim(), limit: '40' },
      signal,
      { timeoutMs: 12_000 },
    );
    return (Array.isArray(data.results) ? data.results : [])
      .map((item, index) => bilibiliItemToSong(item, index))
      .filter((song): song is Song => song !== null);
  },

  async getStreamUrl(song: Song, signal?: AbortSignal): Promise<string> {
    const bvid = rawBvid(song);
    if (!bvid || song.playbackUnavailable === true) throw new Error('Bilibili stream is unavailable');
    const probe = await providerFetch<{ available?: boolean }>(
      'Bilibili',
      'streamProbe',
      `${PROXY_BASE}/stream/${bvid}`,
      { probe: '1', ...(song.duration > 45 ? { expected: String(song.duration) } : {}) },
      signal,
      { timeoutMs: 12_000 },
    );
    if (probe.available !== true) throw new Error('Bilibili stream is unavailable');
    return song.path;
  },

  async getSongsByTag(tag: string, limit = 40, signal?: AbortSignal): Promise<Song[]> {
    return (await this.search(tag, signal)).slice(0, Math.max(0, Math.floor(limit)));
  },

  async getTrending(): Promise<never[]> {
    return [];
  },
};
