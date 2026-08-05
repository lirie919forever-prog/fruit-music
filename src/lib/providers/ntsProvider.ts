'use client';

import type { MusicProvider } from './types';
import { providerFetch } from './errors';
import { createDeterministicCover } from '@/lib/coverArt';
import type { Album, Artist, Song } from '@/types/music';

const PROXY_BASE = '/api/music/nts';
const NTS_ORIGIN = 'https://www.nts.live';

export interface NtsStation {
  id?: string;
  title?: string;
  description?: string;
  genre?: string;
  nowPlaying?: string;
}

interface NtsResponse {
  results?: NtsStation[];
}

function isStationId(value: unknown): value is '1' | '2' {
  return value === '1' || value === '2';
}

function rawId(value: string, prefix: string): '1' | '2' | null {
  const id = value.startsWith(prefix) ? value.slice(prefix.length) : '';
  return isStationId(id) ? id : null;
}

function streamUrl(id: '1' | '2'): string {
  return `https://stream-relay-geo.ntslive.net/${id === '1' ? 'stream' : 'stream2'}`;
}

function stationToSong(station: NtsStation, index = 0): Song | null {
  if (!isStationId(station.id) || !station.title?.trim()) return null;
  const id = station.id;
  const title = station.title.trim();
  const nowPlaying = station.nowPlaying?.trim() || 'Live broadcast';
  const genre = station.genre?.trim() || 'Electronic';
  const sourceUrl = `${NTS_ORIGIN}/`;

  return {
    id: `nts-${id}`,
    title,
    artist: 'NTS Radio',
    artistId: `nts-artist-${id}`,
    album: nowPlaying,
    albumId: `nts-album-${id}`,
    coverArt: createDeterministicCover(`nts:${id}`, 200),
    duration: 0,
    track: index + 1,
    year: 0,
    genre,
    path: streamUrl(id),
    bitRate: 256,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: 0,
    provider: 'NTS Radio',
    sourceUrl,
    creatorUrl: sourceUrl,
    licenseName: 'Official live station',
    licenseUrl: sourceUrl,
    attributionUrl: sourceUrl,
    metadataVerified: true,
    isLive: true,
  };
}

function songsFrom(stations: NtsStation[]): Song[] {
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

function matches(station: NtsStation, query: string): boolean {
  const haystack = `${station.title ?? ''} ${station.description ?? ''} ${station.genre ?? ''} ${station.nowPlaying ?? ''}`;
  return haystack.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

async function stationFetch(params: Record<string, string>, signal?: AbortSignal): Promise<NtsResponse> {
  return providerFetch<NtsResponse>('NTS Radio', 'stations', `${PROXY_BASE}/stations`, params, signal);
}

type NtsProvider = MusicProvider &
  Required<Pick<MusicProvider, 'getAlbumById' | 'getArtistById' | 'getSongById' | 'getArtistAlbums'>>;

export const ntsProvider: NtsProvider = {
  async search(query: string, signal?: AbortSignal): Promise<Song[]> {
    const needle = query.trim();
    if (!needle) return [];
    const data = await stationFetch({}, signal);
    return songsFrom((data.results ?? []).filter((station) => matches(station, needle)));
  },

  async getSongsByTag(tag: string, limit = 20, signal?: AbortSignal): Promise<Song[]> {
    const needle = tag.trim();
    if (!needle) return [];
    return (await this.search(needle, signal)).slice(0, limit);
  },

  async getTrending(limit = 20, signal?: AbortSignal): Promise<Song[]> {
    const data = await stationFetch({}, signal);
    return songsFrom(data.results ?? []).slice(0, limit);
  },

  async getAlbums(signal?: AbortSignal): Promise<Album[]> {
    return (await this.getTrending(2, signal)).map(songToAlbum);
  },

  async getArtists(signal?: AbortSignal): Promise<Artist[]> {
    return (await this.getTrending(2, signal)).map(songToArtist);
  },

  async getAlbumById(albumId: string, signal?: AbortSignal): Promise<Album | null> {
    const id = rawId(albumId, 'nts-album-');
    const song = id ? await this.getSongById(`nts-${id}`, signal) : null;
    return song ? songToAlbum(song) : null;
  },

  async getArtistById(artistId: string, signal?: AbortSignal): Promise<Artist | null> {
    const id = rawId(artistId, 'nts-artist-');
    const song = id ? await this.getSongById(`nts-${id}`, signal) : null;
    return song ? songToArtist(song) : null;
  },

  async getAlbumSongs(albumId: string, signal?: AbortSignal): Promise<Song[]> {
    const id = rawId(albumId, 'nts-album-');
    const song = id ? await this.getSongById(`nts-${id}`, signal) : null;
    return song ? [song] : [];
  },

  async getArtistSongs(artistId: string, signal?: AbortSignal): Promise<Song[]> {
    const id = rawId(artistId, 'nts-artist-');
    const song = id ? await this.getSongById(`nts-${id}`, signal) : null;
    return song ? [song] : [];
  },

  async getArtistAlbums(artistId: string, signal?: AbortSignal): Promise<Album[]> {
    const song = (await this.getArtistSongs(artistId, signal))[0];
    return song ? [songToAlbum(song)] : [];
  },

  async getSongById(songId: string, signal?: AbortSignal): Promise<Song | null> {
    const id = rawId(songId, 'nts-');
    if (!id) return null;
    const data = await stationFetch({ id }, signal);
    return songsFrom(data.results ?? [])[0] ?? null;
  },

  async getStreamUrl(song: Song): Promise<string> {
    return song.path;
  },
};
