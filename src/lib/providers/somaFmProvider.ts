import type { MusicProvider } from './types';
import { providerFetch } from './errors';
import { createDeterministicCover } from '@/lib/coverArt';
import type { Album, Artist, Song } from '@/types/music';

const PROXY_BASE = '/api/music/somafm';
const SOMAFM_ORIGIN = 'https://somafm.com';

export interface SomaFmStation {
  id?: string;
  title?: string;
  description?: string;
  genre?: string;
  lastPlaying?: string;
}

interface SomaFmResponse {
  results?: SomaFmStation[];
}

function isStationId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9-]{1,64}$/.test(value);
}

function rawId(value: string, prefix: string): string | null {
  const id = value.startsWith(prefix) ? value.slice(prefix.length) : '';
  return isStationId(id) ? id : null;
}

function stationSourceUrl(id: string): string {
  return `${SOMAFM_ORIGIN}/${encodeURIComponent(id)}/`;
}

function stationToSong(station: SomaFmStation, index = 0): Song | null {
  if (!isStationId(station.id) || !station.title?.trim()) return null;
  const id = station.id;
  const title = station.title.trim();
  const sourceUrl = stationSourceUrl(id);
  const genre = station.genre?.trim() || 'Live radio';

  return {
    id: `somafm-${id}`,
    title,
    artist: 'SomaFM',
    artistId: `somafm-artist-${id}`,
    album: station.lastPlaying?.trim() || genre,
    albumId: `somafm-album-${id}`,
    coverArt: createDeterministicCover(`somafm:${id}`, 175),
    duration: 0,
    track: index + 1,
    year: 0,
    genre,
    path: `${PROXY_BASE}/stream/${id}`,
    bitRate: 128,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: 0,
    provider: 'SomaFM',
    sourceUrl,
    creatorUrl: SOMAFM_ORIGIN,
    licenseName: 'Official live station',
    licenseUrl: SOMAFM_ORIGIN,
    attributionUrl: sourceUrl,
    metadataVerified: true,
    isLive: true,
  };
}

function songsFrom(stations: SomaFmStation[]): Song[] {
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
    name: song.title,
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

async function stationFetch(params: Record<string, string>, signal?: AbortSignal): Promise<SomaFmResponse> {
  return providerFetch<SomaFmResponse>('SomaFM', 'stations', `${PROXY_BASE}/stations`, params, signal);
}

type SomaFmProvider = MusicProvider &
  Required<Pick<MusicProvider, 'getAlbumById' | 'getArtistById' | 'getSongById' | 'getArtistAlbums'>>;

export const somaFmProvider: SomaFmProvider = {
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

  async getAlbums(signal?: AbortSignal): Promise<Album[]> {
    return uniqueById((await this.getTrending(30, signal)).map(songToAlbum));
  },

  async getArtists(signal?: AbortSignal): Promise<Artist[]> {
    return uniqueById((await this.getTrending(30, signal)).map(songToArtist));
  },

  async getAlbumById(albumId: string, signal?: AbortSignal): Promise<Album | null> {
    const id = rawId(albumId, 'somafm-album-');
    if (!id) return null;
    const song = await this.getSongById(`somafm-${id}`, signal);
    return song ? songToAlbum(song) : null;
  },

  async getArtistById(artistId: string, signal?: AbortSignal): Promise<Artist | null> {
    const id = rawId(artistId, 'somafm-artist-');
    if (!id) return null;
    const song = await this.getSongById(`somafm-${id}`, signal);
    return song ? songToArtist(song) : null;
  },

  async getAlbumSongs(albumId: string, signal?: AbortSignal): Promise<Song[]> {
    const id = rawId(albumId, 'somafm-album-');
    const song = id ? await this.getSongById(`somafm-${id}`, signal) : null;
    return song ? [song] : [];
  },

  async getArtistSongs(artistId: string, signal?: AbortSignal): Promise<Song[]> {
    const id = rawId(artistId, 'somafm-artist-');
    const song = id ? await this.getSongById(`somafm-${id}`, signal) : null;
    return song ? [song] : [];
  },

  async getArtistAlbums(artistId: string, signal?: AbortSignal): Promise<Album[]> {
    const song = (await this.getArtistSongs(artistId, signal))[0];
    return song ? [songToAlbum(song)] : [];
  },

  async getSongById(songId: string, signal?: AbortSignal): Promise<Song | null> {
    const id = rawId(songId, 'somafm-');
    if (!id) return null;
    const data = await stationFetch({ id }, signal);
    return songsFrom(Array.isArray(data.results) ? data.results : [])[0] ?? null;
  },

  async getStreamUrl(song: Song): Promise<string> {
    return song.path;
  },
};
