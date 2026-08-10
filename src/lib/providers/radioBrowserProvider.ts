import type { MusicProvider } from './types';
import { providerFetch } from './errors';
import { createDeterministicCover } from '@/lib/coverArt';
import type { Album, Artist, Song } from '@/types/music';

const PROXY_BASE = '/api/music/radio';
const RADIO_BROWSER_ORIGIN = 'https://www.radio-browser.info/';

export interface RadioBrowserStation {
  id?: string;
  name?: string;
  streamUrl?: string;
  homepage?: string;
  tags?: string;
  codec?: string;
  bitrate?: number;
  countryCode?: string;
}

interface RadioBrowserResponse {
  results?: RadioBrowserStation[];
}

function isStationId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function rawId(value: string, prefix: string): string | null {
  const id = value.startsWith(prefix) ? value.slice(prefix.length) : '';
  return isStationId(id) ? id : null;
}

function streamFormat(contentType: string | undefined): { contentType: string; suffix: string } | null {
  if (contentType === 'audio/mpeg') return { contentType, suffix: 'mp3' };
  if (contentType === 'audio/aac') return { contentType, suffix: 'aac' };
  if (contentType === 'audio/ogg') return { contentType, suffix: 'ogg' };
  if (contentType === 'audio/flac') return { contentType, suffix: 'flac' };
  return null;
}

function stationToSong(station: RadioBrowserStation, index = 0): Song | null {
  if (!isStationId(station.id) || !station.name?.trim() || !station.streamUrl) return null;
  const format = streamFormat(station.codec);
  if (!format) return null;
  const countryCode = station.countryCode?.trim().toUpperCase();
  const artist = countryCode ? `${countryCode} live radio` : 'Live radio';
  const sourceUrl = station.homepage?.trim() || RADIO_BROWSER_ORIGIN;
  const tags = station.tags?.trim() || 'Live radio';

  return {
    id: `radio-${station.id}`,
    title: station.name.trim(),
    artist,
    artistId: `radio-artist-${countryCode || 'global'}`,
    album: tags,
    albumId: `radio-album-${station.id}`,
    coverArt: createDeterministicCover(`radio:${station.id}`, 175),
    duration: 0,
    track: index + 1,
    year: 0,
    genre: tags.split(',')[0]?.trim() || 'Live radio',
    path: station.streamUrl,
    bitRate: Number.isFinite(station.bitrate) ? Math.max(0, Math.round(station.bitrate!)) : 0,
    contentType: format.contentType,
    suffix: format.suffix,
    size: 0,
    provider: 'Radio Browser',
    sourceUrl,
    creatorUrl: sourceUrl,
    licenseName: 'Public live station',
    licenseUrl: RADIO_BROWSER_ORIGIN,
    attributionUrl: sourceUrl,
    metadataVerified: true,
    isLive: true,
  };
}

function songsFrom(stations: RadioBrowserStation[]): Song[] {
  return stations.map(stationToSong).filter((song): song is Song => song !== null);
}

function songToAlbum(song: Song): Album {
  return {
    id: song.albumId,
    name: song.title,
    artist: song.artist,
    artistId: song.artistId,
    coverArt: song.coverArt,
    songCount: 1,
    duration: 0,
    year: 0,
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

async function stationFetch(params: Record<string, string>, signal?: AbortSignal): Promise<RadioBrowserResponse> {
  return providerFetch<RadioBrowserResponse>('Radio Browser', 'stations', `${PROXY_BASE}/stations`, params, signal);
}

type RadioBrowserProvider = MusicProvider &
  Required<Pick<MusicProvider, 'getAlbumById' | 'getArtistById' | 'getSongById' | 'getArtistAlbums'>> & {
    getCountryStations(countryCode: string, limit?: number, signal?: AbortSignal): Promise<Song[]>;
  };

export const radioBrowserProvider: RadioBrowserProvider = {
  async search(query: string, signal?: AbortSignal): Promise<Song[]> {
    if (!query.trim()) return [];
    const data = await stationFetch({ q: query, limit: '30' }, signal);
    return songsFrom(Array.isArray(data.results) ? data.results : []);
  },

  async getSongsByTag(tag: string, limit = 50, signal?: AbortSignal): Promise<Song[]> {
    if (!tag.trim()) return [];
    const data = await stationFetch({ tag, limit: String(Math.min(limit, 30)) }, signal);
    return songsFrom(Array.isArray(data.results) ? data.results : []);
  },

  async getTrending(limit = 50, signal?: AbortSignal): Promise<Song[]> {
    const data = await stationFetch({ limit: String(Math.min(limit, 30)) }, signal);
    return songsFrom(Array.isArray(data.results) ? data.results : []);
  },

  async getCountryStations(countryCode: string, limit = 50, signal?: AbortSignal): Promise<Song[]> {
    const normalizedCountryCode = countryCode.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalizedCountryCode)) return [];
    const data = await stationFetch(
      { country: normalizedCountryCode, limit: String(Math.min(Math.max(1, limit), 30)) },
      signal,
    );
    return songsFrom(Array.isArray(data.results) ? data.results : []);
  },

  async getAlbums(signal?: AbortSignal): Promise<Album[]> {
    return uniqueById((await this.getTrending(30, signal)).map(songToAlbum));
  },

  async getArtists(signal?: AbortSignal): Promise<Artist[]> {
    return uniqueById((await this.getTrending(30, signal)).map(songToArtist));
  },

  async getAlbumById(albumId: string, signal?: AbortSignal): Promise<Album | null> {
    const id = rawId(albumId, 'radio-album-');
    if (!id) return null;
    const song = await this.getSongById(`radio-${id}`, signal);
    return song ? songToAlbum(song) : null;
  },

  async getArtistById(artistId: string, signal?: AbortSignal): Promise<Artist | null> {
    const songs = await this.getArtistSongs(artistId, signal);
    return songs[0] ? songToArtist(songs[0]) : null;
  },

  async getAlbumSongs(albumId: string, signal?: AbortSignal): Promise<Song[]> {
    const id = rawId(albumId, 'radio-album-');
    const song = id ? await this.getSongById(`radio-${id}`, signal) : null;
    return song ? [song] : [];
  },

  async getArtistSongs(artistId: string, signal?: AbortSignal): Promise<Song[]> {
    if (!artistId.startsWith('radio-artist-')) return [];
    const songs = await this.getTrending(30, signal);
    return songs.filter((song) => song.artistId === artistId);
  },

  async getArtistAlbums(artistId: string, signal?: AbortSignal): Promise<Album[]> {
    return (await this.getArtistSongs(artistId, signal)).map(songToAlbum);
  },

  async getSongById(songId: string, signal?: AbortSignal): Promise<Song | null> {
    const id = rawId(songId, 'radio-');
    if (!id) return null;
    const data = await stationFetch({ id }, signal);
    return songsFrom(Array.isArray(data.results) ? data.results : [])[0] ?? null;
  },

  async getStreamUrl(song: Song, signal?: AbortSignal): Promise<string> {
    const currentStation = await this.getSongById(song.id, signal);
    return currentStation?.path ?? '';
  },
};
