import type { MusicProvider } from './types';
import { providerFetch } from './errors';
import { createDeterministicCover } from '@/lib/coverArt';
import { normalizeCreativeCommonsLicense } from '@/lib/licenses';
import type { Album, Artist, Song } from '@/types/music';

const PROXY_BASE = '/api/music/wikimedia';
const COMMONS_ORIGIN = 'https://commons.wikimedia.org';
const COMMONS_UPLOAD_HOST = 'upload.wikimedia.org';
// A media file shorter than a minute is usually a musical example, a sound
// effect, or a clip. Keeping those out of the music catalog avoids presenting
// a short sample as a full track.
const MIN_FULL_TRACK_DURATION_SECONDS = 60;

export interface WikimediaAudio {
  id?: number;
  title?: string;
  url?: string;
  descriptionUrl?: string;
  mime?: string;
  duration?: number;
  size?: number;
  artist?: string;
  description?: string;
  licenseUrl?: string;
  date?: string;
  categories?: string;
}

interface WikimediaResponse {
  results?: WikimediaAudio[];
}

function isWikimediaId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function rawId(value: string, prefix: string): string | null {
  if (!value.startsWith(prefix)) return null;
  const id = value.slice(prefix.length);
  return /^[1-9]\d{0,15}$/.test(id) ? id : null;
}

function safeCommonsUploadUrl(value: string | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.hostname === COMMONS_UPLOAD_HOST
      ? url.toString()
      : '';
  } catch {
    return '';
  }
}

function safeCommonsPageUrl(value: string | undefined, id: number): string {
  if (value) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && url.hostname === 'commons.wikimedia.org') return url.toString();
    } catch {
      // Fall through to the stable file page.
    }
  }
  return `${COMMONS_ORIGIN}/?curid=${id}`;
}

function audioFormat(mime: string | undefined, url: string): { contentType: string; suffix: string } | null {
  const value = `${mime || ''} ${new URL(url).pathname}`.toLowerCase();
  if (value.includes('mp3') || value.includes('audio/mpeg')) return { contentType: 'audio/mpeg', suffix: 'mp3' };
  if (value.includes('ogg') || value.includes('oga') || value.includes('opus')) {
    return { contentType: 'audio/ogg', suffix: 'ogg' };
  }
  if (value.includes('flac')) return { contentType: 'audio/flac', suffix: 'flac' };
  if (value.includes('m4a') || value.includes('aac') || value.includes('mp4')) {
    return { contentType: 'audio/mp4', suffix: 'm4a' };
  }
  if (value.includes('wav')) return { contentType: 'audio/wav', suffix: 'wav' };
  return null;
}

function durationSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function releaseYear(value: string | undefined): number {
  return value ? Number(value.slice(0, 4)) || 0 : 0;
}

function creatorId(creator: string): string {
  return `wikimedia-artist-${encodeURIComponent(creator)}`;
}

function decodeCreator(artistId: string): string | null {
  if (!artistId.startsWith('wikimedia-artist-')) return null;
  try {
    const creator = decodeURIComponent(artistId.slice('wikimedia-artist-'.length));
    return creator && creator.length <= 200 ? creator : null;
  } catch {
    return null;
  }
}

function normalizedTitle(title: string): string {
  return title.replace(/^file:/i, '').trim() || 'Untitled recording';
}

function isPlayableAudio(
  item: WikimediaAudio,
): item is WikimediaAudio & { id: number; title: string; url: string; licenseUrl: string } {
  if (!isWikimediaId(item.id) || !item.title || !item.url || !item.licenseUrl) return false;
  const duration = durationSeconds(item.duration);
  return (
    Boolean(safeCommonsUploadUrl(item.url)) &&
    duration >= MIN_FULL_TRACK_DURATION_SECONDS &&
    Number.isFinite(item.size) &&
    (item.size ?? 0) > 0 &&
    Boolean(audioFormat(item.mime, item.url)) &&
    Boolean(normalizeCreativeCommonsLicense(item.licenseUrl))
  );
}

/** Wikimedia Commons exposes the original licensed file, not a catalog preview. */
export function wikimediaAudioToSong(item: WikimediaAudio, index = 0): Song | null {
  if (!isPlayableAudio(item)) return null;
  const uploadUrl = safeCommonsUploadUrl(item.url);
  const format = audioFormat(item.mime, uploadUrl);
  const license = normalizeCreativeCommonsLicense(item.licenseUrl);
  if (!format || !license) return null;

  const title = normalizedTitle(item.title);
  const artist = item.artist?.trim() || 'Wikimedia Commons contributor';
  const sourceUrl = safeCommonsPageUrl(item.descriptionUrl, item.id);

  return {
    id: `wikimedia-${item.id}`,
    title,
    artist,
    artistId: creatorId(artist),
    album: 'Wikimedia Commons',
    albumId: `wikimedia-album-${item.id}`,
    coverArt: createDeterministicCover(`${artist}:${title}`, 110),
    duration: durationSeconds(item.duration),
    track: index + 1,
    year: releaseYear(item.date),
    genre: item.categories?.split('|').find(Boolean) || '',
    path: `${PROXY_BASE}/stream/${item.id}`,
    bitRate: 0,
    contentType: format.contentType,
    suffix: format.suffix,
    size: Math.round(item.size || 0),
    provider: 'Wikimedia Commons',
    sourceUrl,
    creatorUrl: sourceUrl,
    licenseName: license.name,
    licenseUrl: license.url,
    attributionUrl: sourceUrl,
    metadataVerified: true,
  };
}

function songsFrom(items: WikimediaAudio[]): Song[] {
  return items.map(wikimediaAudioToSong).filter((song): song is Song => song !== null);
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

function songToArtist(song: Song): Artist {
  return {
    id: song.artistId,
    name: song.artist,
    coverArt: song.coverArt,
    albumCount: 1,
  };
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

async function commonsFetch(params: Record<string, string>, signal?: AbortSignal): Promise<WikimediaResponse> {
  return providerFetch<WikimediaResponse>('Wikimedia Commons', 'audio', `${PROXY_BASE}/tracks`, params, signal);
}

type WikimediaProvider = MusicProvider &
  Required<
    Pick<
      MusicProvider,
      'getAlbumById' | 'getArtistById' | 'getSongById' | 'searchAlbums' | 'searchArtists' | 'getArtistAlbums'
    >
  >;

export const wikimediaProvider: WikimediaProvider = {
  async search(query: string, signal?: AbortSignal): Promise<Song[]> {
    if (!query.trim()) return [];
    const data = await commonsFetch({ q: query, limit: '20' }, signal);
    return songsFrom(Array.isArray(data.results) ? data.results : []);
  },

  async getSongsByTag(tag: string, limit = 50, signal?: AbortSignal): Promise<Song[]> {
    if (!tag.trim()) return [];
    const data = await commonsFetch({ q: tag, limit: String(Math.min(limit, 20)) }, signal);
    return songsFrom(Array.isArray(data.results) ? data.results : []);
  },

  async getTrending(limit = 50, signal?: AbortSignal): Promise<Song[]> {
    // Commons does not publish a popularity ranking. Its API can order search
    // results by creation time, making this a fresh full-recording feed.
    const data = await commonsFetch({ q: 'music', sort: 'recent', limit: String(Math.min(limit, 20)) }, signal);
    return songsFrom(Array.isArray(data.results) ? data.results : []);
  },

  async getAlbums(signal?: AbortSignal): Promise<Album[]> {
    return uniqueById((await this.getTrending(40, signal)).map(songToAlbum));
  },

  async getArtists(signal?: AbortSignal): Promise<Artist[]> {
    return uniqueById((await this.getTrending(40, signal)).map(songToArtist));
  },

  async searchAlbums(query: string, signal?: AbortSignal): Promise<Album[]> {
    return uniqueById((await this.search(query, signal)).map(songToAlbum));
  },

  async searchArtists(query: string, signal?: AbortSignal): Promise<Artist[]> {
    return uniqueById((await this.search(query, signal)).map(songToArtist));
  },

  async getSongById(songId: string, signal?: AbortSignal): Promise<Song | null> {
    const id = rawId(songId, 'wikimedia-');
    if (!id) return null;
    const data = await commonsFetch({ id }, signal);
    return songsFrom(Array.isArray(data.results) ? data.results : [])[0] ?? null;
  },

  async getAlbumById(albumId: string, signal?: AbortSignal): Promise<Album | null> {
    const id = rawId(albumId, 'wikimedia-album-');
    if (!id) return null;
    const song = await this.getSongById(`wikimedia-${id}`, signal);
    return song ? songToAlbum(song) : null;
  },

  async getAlbumSongs(albumId: string, signal?: AbortSignal): Promise<Song[]> {
    const id = rawId(albumId, 'wikimedia-album-');
    if (!id) return [];
    const song = await this.getSongById(`wikimedia-${id}`, signal);
    return song ? [song] : [];
  },

  async getArtistById(artistId: string, signal?: AbortSignal): Promise<Artist | null> {
    const songs = await this.getArtistSongs(artistId, signal);
    return songs[0] ? songToArtist(songs[0]) : null;
  },

  async getArtistSongs(artistId: string, signal?: AbortSignal): Promise<Song[]> {
    const creator = decodeCreator(artistId);
    if (!creator) return [];
    const songs = await this.search(creator, signal);
    return songs.filter((song) => song.artist.toLocaleLowerCase() === creator.toLocaleLowerCase());
  },

  async getArtistAlbums(artistId: string, signal?: AbortSignal): Promise<Album[]> {
    return uniqueById((await this.getArtistSongs(artistId, signal)).map(songToAlbum));
  },

  async getStreamUrl(song: Song): Promise<string> {
    return song.path;
  },
};
