/**
 * Jamendo Music Provider
 *
 * Uses the free Jamendo API (v3.0) to fetch real, legal music content.
 * All calls go through our Next.js API proxy at /api/music/jamendo/...
 * so the API key never reaches the browser.
 *
 * Jamendo offers:
 *   - ~500,000+ CC-licensed tracks
 *   - Real MP3 streams (96kbps free tier)
 *   - Real album art images
 *   - Full albums, artists, genres, moods
 *
 * Register at https://devportal.jamendo.com/ to get a client_id.
 * Set JAMENDO_CLIENT_ID in .env.local
 */

import type { MusicProvider } from './types';
import { providerFetch } from './errors';
import { normalizeCreativeCommonsLicense } from '@/lib/licenses';
import { safeCoverArt } from '@/lib/coverArt';
import type { Album, Artist, Song } from '@/types/music';

const PROXY_BASE = '/api/music/jamendo';

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

async function jamendoFetch<T>(path: string, params: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
  return providerFetch<T>('Jamendo', path.split('/').pop() || 'request', path, params, signal);
}

interface JamendoTrack {
  id?: string;
  name?: string;
  artist_name?: string;
  artist_id?: string;
  album_name?: string;
  album_id?: string;
  image?: string;
  duration?: number;
  position?: number;
  audiodownload_allowed?: boolean;
  audio?: string;
  license_ccurl?: string;
  shareurl?: string;
}

interface JamendoArtist {
  id?: string;
  name?: string;
  image?: string;
  albums_count?: number;
  joindate?: string;
}

interface JamendoAlbum {
  id?: string;
  name?: string;
  artist_id?: string;
  artist_name?: string;
  image?: string;
  releasedate?: string;
  shareurl?: string;
}

function isJamendoId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value);
}

function isJamendoTrack(track: JamendoTrack): track is JamendoTrack & { id: string; audio: string; duration: number } {
  return isJamendoId(track?.id) &&
    typeof track.audio === 'string' && track.audio.startsWith('https://') &&
    typeof track.duration === 'number' && track.duration > 0 &&
    normalizeCreativeCommonsLicense(track.license_ccurl) !== null;
}

function isJamendoArtist(artist: JamendoArtist): artist is JamendoArtist & { id: string } {
  return isJamendoId(artist?.id);
}

function isJamendoAlbum(album: JamendoAlbum): album is JamendoAlbum & { id: string } {
  return isJamendoId(album?.id);
}

export function jamendoTrackToSong(t: JamendoTrack & { id: string; audio: string; duration: number }): Song {
  const artistId = isJamendoId(t.artist_id) ? t.artist_id : '0';
  const albumId = isJamendoId(t.album_id) ? t.album_id : t.id;
  const license = normalizeCreativeCommonsLicense(t.license_ccurl);
  if (!license) throw new Error('Jamendo track is missing a supported Creative Commons license');

  return {
    id: `jamendo-${t.id}`,
    title: decodeHtml(t.name || 'Unknown'),
    artist: decodeHtml(t.artist_name || 'Unknown'),
    artistId: `jamendo-artist-${artistId}`,
    album: decodeHtml(t.album_name || 'Unknown'),
    albumId: `jamendo-${albumId}`,
    coverArt: safeCoverArt(t.image),
    duration: Number.isFinite(t.duration) ? Math.max(0, Math.round(t.duration!)) : 0,
    track: Number.isFinite(t.position) ? Math.max(0, Math.round(t.position!)) : 0,
    year: 0,
    genre: '',
    path: `/api/music/jamendo/stream/${t.id}`,
    bitRate: 0,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: 0,
    provider: 'Jamendo',
    sourceUrl: t.shareurl || `https://www.jamendo.com/track/${t.id}`,
    creatorUrl: isJamendoId(t.artist_id) ? `https://www.jamendo.com/artist/${t.artist_id}` : '',
    licenseName: license.name,
    licenseUrl: license.url,
    attributionUrl: t.shareurl || `https://www.jamendo.com/track/${t.id}`,
    metadataVerified: true,
  };
}

function jamendoAlbumToAlbum(album: JamendoAlbum & { id: string }): Album {
  return {
    id: `jamendo-${album.id}`,
    name: decodeHtml(album.name || 'Unknown'),
    artist: decodeHtml(album.artist_name || 'Unknown'),
    artistId: `jamendo-artist-${isJamendoId(album.artist_id) ? album.artist_id : '0'}`,
    coverArt: safeCoverArt(album.image),
    songCount: 0,
    duration: 0,
    year: Number(album.releasedate?.slice(0, 4)) || 0,
    genre: '',
  };
}

function jamendoArtistToArtist(a: JamendoArtist & { id: string }): Artist {
  return {
    id: `jamendo-artist-${a.id}`,
    name: decodeHtml(a.name || 'Unknown'),
    coverArt: safeCoverArt(a.image),
    albumCount: a.albums_count || 0,
  };
}

type JamendoProvider = MusicProvider & Required<Pick<MusicProvider,
  | 'getAlbumById'
  | 'getArtistById'
  | 'getSongById'
>>;

export const jamendoProvider: JamendoProvider = {
  async getAlbums(signal?: AbortSignal): Promise<Album[]> {
    const data = await jamendoFetch<{ results: JamendoAlbum[] }>(`${PROXY_BASE}/albums`, {
      limit: '100',
      order: 'releasedate_desc',
    }, signal);
    if (!Array.isArray(data?.results)) return [];

    return data.results.filter(isJamendoAlbum).map(jamendoAlbumToAlbum);
  },

  // Deep links can target records outside the paged catalog listing, so the
  // detail lookup queries the provider by id instead of scanning that page.
  async getAlbumById(albumId: string, signal?: AbortSignal): Promise<Album | null> {
    const rawId = albumId.replace('jamendo-', '');
    if (!isJamendoId(rawId)) return null;
    const data = await jamendoFetch<{ results: JamendoAlbum[] }>(`${PROXY_BASE}/albums`, {
      id: rawId,
      limit: '1',
    }, signal);
    const album = Array.isArray(data?.results) ? data.results.find(isJamendoAlbum) : undefined;
    return album ? jamendoAlbumToAlbum(album) : null;
  },

  async getArtistById(artistId: string, signal?: AbortSignal): Promise<Artist | null> {
    const rawId = artistId.replace('jamendo-artist-', '');
    if (!isJamendoId(rawId)) return null;
    const data = await jamendoFetch<{ results: JamendoArtist[] }>(`${PROXY_BASE}/artists`, {
      id: rawId,
      limit: '1',
    }, signal);
    const artist = Array.isArray(data?.results) ? data.results.find(isJamendoArtist) : undefined;
    return artist ? jamendoArtistToArtist(artist) : null;
  },

  async getArtists(signal?: AbortSignal): Promise<Artist[]> {
    const data = await jamendoFetch<{ results: JamendoArtist[] }>(`${PROXY_BASE}/artists`, {
      limit: '100',
      order: 'popularity_total',
    }, signal);
    if (!Array.isArray(data?.results)) return [];
    return data.results.filter(isJamendoArtist).map(jamendoArtistToArtist);
  },

  async getAlbumSongs(albumId: string, signal?: AbortSignal): Promise<Song[]> {
    const rawId = albumId.replace('jamendo-', '');
    const data = await jamendoFetch<{ results: JamendoTrack[] }>(`${PROXY_BASE}/tracks`, {
      album_id: rawId,
      limit: '100',
      audioformat: 'mp31',
    }, signal);
    if (!Array.isArray(data?.results)) return [];
    return data.results.filter(isJamendoTrack).map(jamendoTrackToSong);
  },

  async getArtistSongs(artistId: string, signal?: AbortSignal): Promise<Song[]> {
    const rawId = artistId.replace('jamendo-artist-', '');
    const data = await jamendoFetch<{ results: JamendoTrack[] }>(`${PROXY_BASE}/tracks`, {
      artist_id: rawId,
      limit: '100',
      audioformat: 'mp31',
    }, signal);
    if (!Array.isArray(data?.results)) return [];
    return data.results.filter(isJamendoTrack).map(jamendoTrackToSong);
  },

  async search(query: string, signal?: AbortSignal): Promise<Song[]> {
    const data = await jamendoFetch<{ results: JamendoTrack[] }>(`${PROXY_BASE}/tracks`, {
      search: query,
      limit: '50',
      audioformat: 'mp31',
    }, signal);
    if (!Array.isArray(data?.results)) return [];
    return data.results.filter(isJamendoTrack).map(jamendoTrackToSong);
  },

  async getSongById(songId: string, signal?: AbortSignal): Promise<Song | null> {
    const rawId = songId.replace('jamendo-', '');
    if (!isJamendoId(rawId)) return null;
    const data = await jamendoFetch<{ results: JamendoTrack[] }>(`${PROXY_BASE}/tracks`, {
      id: rawId,
      limit: '1',
      audioformat: 'mp31',
    }, signal);
    const track = Array.isArray(data?.results) ? data.results.find(isJamendoTrack) : undefined;
    return track ? jamendoTrackToSong(track) : null;
  },

  async getStreamUrl(song: Song): Promise<string> {
    return song.path;
  },

  async getSongsByTag(tag: string, limit = 200, signal?: AbortSignal): Promise<Song[]> {
    const data = await jamendoFetch<{ results: JamendoTrack[] }>(`${PROXY_BASE}/tracks`, {
      fuzzytags: tag,
      limit: String(limit),
      audioformat: 'mp31',
      order: 'popularity_total',
    }, signal);
    if (!Array.isArray(data?.results)) return [];
    return data.results.filter(isJamendoTrack).map(jamendoTrackToSong);
  },

  async getTrending(limit = 200, signal?: AbortSignal): Promise<Song[]> {
    const data = await jamendoFetch<{ results: JamendoTrack[] }>(`${PROXY_BASE}/tracks`, {
      featured: '1',
      limit: String(limit),
      audioformat: 'mp31',
      order: 'popularity_total',
      boost: 'popularity_total',
    }, signal);
    if (!Array.isArray(data?.results)) return [];
    return data.results.filter(isJamendoTrack).map(jamendoTrackToSong);
  },
};
