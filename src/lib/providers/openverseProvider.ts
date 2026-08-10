import type { MusicProvider } from './types';
import { providerFetch } from './errors';
import { createDeterministicCover } from '@/lib/coverArt';
import { normalizeCreativeCommonsLicense } from '@/lib/licenses';
import type { Album, Artist, Song } from '@/types/music';

const PROXY_BASE = '/api/music/openverse';
const OPENVERSE_ORIGIN = 'https://api.openverse.org';
const MIN_FULL_TRACK_DURATION_SECONDS = 60;

interface OpenverseAudioSet {
  title?: string;
}

export interface OpenverseAudio {
  id?: string;
  title?: string;
  url?: string;
  creator?: string;
  creator_url?: string;
  foreign_landing_url?: string;
  license_url?: string;
  duration?: number;
  filetype?: string;
  genres?: string[];
  source?: string;
  mature?: boolean;
  audio_set?: OpenverseAudioSet | null;
}

interface OpenverseResponse {
  results?: OpenverseAudio[];
}

function isOpenverseId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function safeHttpsUrl(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function creatorId(creator: string): string {
  return `openverse-artist-${encodeURIComponent(creator)}`;
}

function decodeCreator(artistId: string): string | null {
  const encoded = artistId.replace('openverse-artist-', '');
  try {
    const creator = decodeURIComponent(encoded);
    return creator && creator.length <= 200 ? creator : null;
  } catch {
    return null;
  }
}

function durationSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  // Openverse documents this field in milliseconds. Treating a 574 ms sound
  // effect as 574 seconds made a short preview look like a full recording.
  return Math.max(1, Math.round(value / 1_000));
}

function isPreviewAsset(url: string): boolean {
  try {
    return /\/previews?\//i.test(new URL(url).pathname);
  } catch {
    return true;
  }
}

function audioFormat(filetype: string | undefined, url: string): { contentType: string; suffix: string } | null {
  const value = `${filetype || ''} ${new URL(url).pathname}`.toLowerCase();
  if (value.includes('mp3')) return { contentType: 'audio/mpeg', suffix: 'mp3' };
  if (value.includes('ogg') || value.includes('oga')) return { contentType: 'audio/ogg', suffix: 'ogg' };
  if (value.includes('wav')) return { contentType: 'audio/wav', suffix: 'wav' };
  if (value.includes('flac')) return { contentType: 'audio/flac', suffix: 'flac' };
  if (value.includes('m4a') || value.includes('aac') || value.includes('mp4')) {
    return { contentType: 'audio/mp4', suffix: 'm4a' };
  }
  return null;
}

function isPlayableAudio(
  item: OpenverseAudio,
): item is OpenverseAudio & { id: string; title: string; creator: string; url: string } {
  if (!isOpenverseId(item.id) || !item.title || !item.creator || item.mature === true || !item.url) return false;
  const path = safeHttpsUrl(item.url, '');
  return (
    Boolean(path) &&
    !isPreviewAsset(path) &&
    item.source?.toLocaleLowerCase() !== 'freesound' &&
    durationSeconds(item.duration) >= MIN_FULL_TRACK_DURATION_SECONDS &&
    Boolean(normalizeCreativeCommonsLicense(item.license_url))
  );
}

/** Openverse indexes Creative Commons audio across multiple public archives. */
export function openverseAudioToSong(item: OpenverseAudio, index = 0): Song | null {
  if (!isPlayableAudio(item)) return null;
  const path = safeHttpsUrl(item.url, '');
  const format = audioFormat(item.filetype, path);
  const license = normalizeCreativeCommonsLicense(item.license_url);
  if (!format || !license) return null;
  const detailUrl = `${OPENVERSE_ORIGIN}/v1/audio/${item.id}/`;
  const sourceUrl = safeHttpsUrl(item.foreign_landing_url, detailUrl);
  const album = item.audio_set?.title || item.source || 'Openverse';

  return {
    id: `openverse-${item.id}`,
    title: item.title,
    artist: item.creator,
    artistId: creatorId(item.creator),
    album,
    albumId: `openverse-album-${item.id}`,
    // Source thumbnails are available through many unrelated hosts. A local
    // generated cover keeps the image policy narrow while audio stays direct.
    coverArt: createDeterministicCover(`${item.creator}:${album}`, 110),
    duration: durationSeconds(item.duration),
    track: index + 1,
    year: 0,
    genre: item.genres?.[0] || '',
    path,
    bitRate: 0,
    contentType: format.contentType,
    suffix: format.suffix,
    size: 0,
    provider: 'Openverse',
    sourceUrl,
    creatorUrl: safeHttpsUrl(item.creator_url, sourceUrl),
    licenseName: license.name,
    licenseUrl: license.url,
    attributionUrl: sourceUrl,
    metadataVerified: true,
  };
}

function songsFrom(items: OpenverseAudio[]): Song[] {
  return items.map(openverseAudioToSong).filter((song): song is Song => song !== null);
}

async function openverseFetch(params: Record<string, string>, signal?: AbortSignal): Promise<OpenverseResponse> {
  return providerFetch<OpenverseResponse>('Openverse', 'audio', `${PROXY_BASE}/tracks`, params, signal);
}

function rawSongId(songId: string): string | null {
  const id = songId.replace('openverse-', '');
  return isOpenverseId(id) ? id : null;
}

function rawAlbumId(albumId: string): string | null {
  const id = albumId.replace('openverse-album-', '');
  return isOpenverseId(id) ? id : null;
}

function songToAlbum(song: Song): Album {
  return {
    id: song.albumId,
    name: song.album,
    artist: song.artist,
    artistId: song.artistId,
    coverArt: song.coverArt,
    songCount: 1,
    duration: song.duration,
    year: song.year,
    genre: song.genre,
  };
}

export const openverseProvider: MusicProvider &
  Required<Pick<MusicProvider, 'getAlbumById' | 'getArtistById' | 'getSongById'>> = {
  async search(query: string, signal?: AbortSignal): Promise<Song[]> {
    if (!query.trim()) return [];
    const data = await openverseFetch({ q: query, limit: '20' }, signal);
    return songsFrom(Array.isArray(data.results) ? data.results : []);
  },

  async getSongsByTag(tag: string, limit = 50, signal?: AbortSignal): Promise<Song[]> {
    if (!tag.trim()) return [];
    const data = await openverseFetch({ q: tag, limit: String(Math.min(limit, 20)) }, signal);
    return songsFrom(Array.isArray(data.results) ? data.results : []);
  },

  async getTrending(): Promise<Song[]> {
    // Openverse deliberately exposes search, not a popularity ranking. Calling
    // a generic search result "trending" would be fabricated metadata.
    return [];
  },

  async getAlbums(): Promise<Album[]> {
    return [];
  },

  async getArtists(): Promise<Artist[]> {
    return [];
  },

  async getAlbumById(albumId: string, signal?: AbortSignal): Promise<Album | null> {
    const id = rawAlbumId(albumId);
    if (!id) return null;
    const song = await this.getSongById(`openverse-${id}`, signal);
    return song ? songToAlbum(song) : null;
  },

  async getAlbumSongs(albumId: string, signal?: AbortSignal): Promise<Song[]> {
    const id = rawAlbumId(albumId);
    if (!id) return [];
    const song = await this.getSongById(`openverse-${id}`, signal);
    return song ? [song] : [];
  },

  async getArtistById(artistId: string, signal?: AbortSignal): Promise<Artist | null> {
    const creator = decodeCreator(artistId);
    if (!creator) return null;
    const songs = await this.getArtistSongs(artistId, signal);
    const first = songs[0];
    return first
      ? {
          id: artistId,
          name: first.artist,
          coverArt: first.coverArt,
          albumCount: new Set(songs.map((song) => song.album)).size,
        }
      : null;
  },

  async getArtistSongs(artistId: string, signal?: AbortSignal): Promise<Song[]> {
    const creator = decodeCreator(artistId);
    if (!creator) return [];
    const data = await openverseFetch({ creator, limit: '20' }, signal);
    return songsFrom(Array.isArray(data.results) ? data.results : []);
  },

  async getSongById(songId: string, signal?: AbortSignal): Promise<Song | null> {
    const id = rawSongId(songId);
    if (!id) return null;
    const data = await openverseFetch({ id }, signal);
    return songsFrom(Array.isArray(data.results) ? data.results : [])[0] ?? null;
  },

  async getStreamUrl(song: Song): Promise<string> {
    return song.path;
  },
};
