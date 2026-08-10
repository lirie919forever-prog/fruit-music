import type { MusicProvider } from './types';
import { providerFetch } from './errors';
import { createDeterministicCover, safeCoverArt } from '@/lib/coverArt';
import type { Song } from '@/types/music';

const PROXY_BASE = '/api/music/invidious';
const INVIDIOUS_TERMS_URL = 'https://invidious.io/';
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

interface InvidiousSearchItem {
  videoId?: string;
  title?: string;
  author?: string;
  lengthSeconds?: number;
  videoThumbnails?: Array<{ url?: string }>;
  description?: string;
}

interface InvidiousSearchResponse {
  results?: InvidiousSearchItem[];
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
  'a cappella',
  'mashup',
  'compilation',
  'mv reaction',
  'lyrics video',
  '1 hour',
  '10 hours',
];

function isExcludedTitle(title: string): boolean {
  const normalized = title.toLocaleLowerCase();
  return EXCLUDED_TITLE_MARKERS.some((marker) => normalized.includes(marker));
}

function safeInvidiousArtwork(thumbnails: InvidiousSearchItem['videoThumbnails'], seed: string): string {
  const url = thumbnails?.at(0)?.url;
  const cover = safeCoverArt(url);
  return cover === '/placeholder-album.svg' ? createDeterministicCover(seed, 150) : cover;
}

export function invidiousItemToSong(item: InvidiousSearchItem, index = 0): Song | null {
  const videoId = item.videoId?.trim() || '';
  const title = item.title?.trim() || '';
  const artist = item.author?.trim() || '';
  const duration = typeof item.lengthSeconds === 'number' ? item.lengthSeconds : 0;
  if (!VIDEO_ID_PATTERN.test(videoId) || !title || !artist || duration < 45 || isExcludedTitle(title)) return null;

  const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;
  return {
    id: `invidious-${videoId}`,
    title,
    artist,
    artistId: `invidious-artist-${videoId}`,
    album: title,
    albumId: `invidious-album-${videoId}`,
    coverArt: safeInvidiousArtwork(item.videoThumbnails, `${artist}:${title}`),
    duration,
    track: index + 1,
    year: 0,
    genre: '',
    path: `${PROXY_BASE}/stream/${videoId}`,
    bitRate: 0,
    contentType: 'audio/mp4',
    suffix: 'm4a',
    size: 0,
    provider: 'Invidious',
    sourceUrl,
    creatorUrl: `https://www.youtube.com/@${artist}`,
    licenseName: 'Platform terms',
    licenseUrl: INVIDIOUS_TERMS_URL,
    attributionUrl: sourceUrl,
    metadataVerified: false,
  };
}

function rawVideoId(song: Song): string | null {
  const value = song.id.startsWith('invidious-') ? song.id.slice('invidious-'.length) : '';
  return VIDEO_ID_PATTERN.test(value) ? value : null;
}

export const invidiousProvider: MusicProvider = {
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
    const data = await providerFetch<InvidiousSearchResponse>(
      'Invidious',
      'search',
      `${PROXY_BASE}/tracks`,
      { q: query.trim(), limit: '40' },
      signal,
      { timeoutMs: 12_000 },
    );
    return (Array.isArray(data.results) ? data.results : [])
      .map((item, index) => invidiousItemToSong(item, index))
      .filter((song): song is Song => song !== null);
  },

  async getStreamUrl(song: Song, signal?: AbortSignal): Promise<string> {
    const videoId = rawVideoId(song);
    if (!videoId || song.playbackUnavailable === true) throw new Error('Invidious stream is unavailable');
    const probe = await providerFetch<{ available?: boolean }>(
      'Invidious',
      'streamProbe',
      `${PROXY_BASE}/stream/${videoId}`,
      { probe: '1', ...(song.duration > 45 ? { expected: String(song.duration) } : {}) },
      signal,
      { timeoutMs: 12_000 },
    );
    if (probe.available !== true) throw new Error('Invidious stream is unavailable');
    return song.path;
  },

  async getSongsByTag(tag: string, limit = 40, signal?: AbortSignal): Promise<Song[]> {
    return (await this.search(tag, signal)).slice(0, Math.max(0, Math.floor(limit)));
  },

  async getTrending(): Promise<never[]> {
    return [];
  },
};
