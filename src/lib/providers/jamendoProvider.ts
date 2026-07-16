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

async function jamendoFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  return providerFetch<T>('Jamendo', path.split('/').pop() || 'request', path, params);
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
    coverArt: t.image || '/placeholder-album.svg',
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

function jamendoArtistToArtist(a: JamendoArtist & { id: string }): Artist {
  return {
    id: `jamendo-artist-${a.id}`,
    name: decodeHtml(a.name || 'Unknown'),
    coverArt: a.image || '/placeholder-album.svg',
    albumCount: a.albums_count || 0,
  };
}

export const jamendoProvider: MusicProvider = {
  async getAlbums(): Promise<Album[]> {
    // The /albums endpoint returns recently-released albums with no track counts.
    // Instead, derive albums from the popular tracks list so counts are always accurate.
    const data = await jamendoFetch<{ results: JamendoTrack[] }>(`${PROXY_BASE}/tracks`, {
      limit: '200',
      audioformat: 'mp31',
      order: 'popularity_total',
    });
    if (!Array.isArray(data?.results)) return [];

    const seen = new Map<string, Album>();
    for (const t of data.results.filter(isJamendoTrack)) {
      const albumId = isJamendoId(t.album_id) ? t.album_id : t.id;
      const artistId = isJamendoId(t.artist_id) ? t.artist_id : '0';
      if (!seen.has(albumId)) {
        seen.set(albumId, {
          id: `jamendo-${albumId}`,
          name: decodeHtml(t.album_name || 'Unknown'),
          artist: decodeHtml(t.artist_name || 'Unknown'),
          artistId: `jamendo-artist-${artistId}`,
          coverArt: t.image || '/placeholder-album.svg',
          songCount: 0,
          duration: 0,
          year: 0,
          genre: '',
        });
      }
      seen.get(albumId)!.songCount++;
    }

    return Array.from(seen.values());
  },

  async getArtists(): Promise<Artist[]> {
    const data = await jamendoFetch<{ results: JamendoArtist[] }>(`${PROXY_BASE}/artists`, {
      limit: '100',
      order: 'popularity_total',
    });
    if (!Array.isArray(data?.results)) return [];
    return data.results.filter(isJamendoArtist).map(jamendoArtistToArtist);
  },

  async getAlbumSongs(albumId: string): Promise<Song[]> {
    const rawId = albumId.replace('jamendo-', '');
    const data = await jamendoFetch<{ results: JamendoTrack[] }>(`${PROXY_BASE}/tracks`, {
      album_id: rawId,
      limit: '100',
      audioformat: 'mp31',
    });
    if (!Array.isArray(data?.results)) return [];
    return data.results.filter(isJamendoTrack).map(jamendoTrackToSong);
  },

  async getArtistSongs(artistId: string): Promise<Song[]> {
    const rawId = artistId.replace('jamendo-artist-', '');
    const data = await jamendoFetch<{ results: JamendoTrack[] }>(`${PROXY_BASE}/tracks`, {
      artist_id: rawId,
      limit: '100',
      audioformat: 'mp31',
    });
    if (!Array.isArray(data?.results)) return [];
    return data.results.filter(isJamendoTrack).map(jamendoTrackToSong);
  },

  async search(query: string): Promise<Song[]> {
    const data = await jamendoFetch<{ results: JamendoTrack[] }>(`${PROXY_BASE}/tracks`, {
      search: query,
      limit: '50',
      audioformat: 'mp31',
    });
    if (!Array.isArray(data?.results)) return [];
    return data.results.filter(isJamendoTrack).map(jamendoTrackToSong);
  },

  async getStreamUrl(song: Song): Promise<string> {
    return song.path;
  },

  async getSongsByTag(tag: string, limit = 200): Promise<Song[]> {
    const data = await jamendoFetch<{ results: JamendoTrack[] }>(`${PROXY_BASE}/tracks`, {
      fuzzytags: tag,
      limit: String(limit),
      audioformat: 'mp31',
      order: 'popularity_total',
    });
    if (!Array.isArray(data?.results)) return [];
    return data.results.filter(isJamendoTrack).map(jamendoTrackToSong);
  },

  async getTrending(limit = 200): Promise<Song[]> {
    const data = await jamendoFetch<{ results: JamendoTrack[] }>(`${PROXY_BASE}/tracks`, {
      featured: '1',
      limit: String(limit),
      audioformat: 'mp31',
      order: 'popularity_total',
      boost: 'popularity_total',
    });
    if (!Array.isArray(data?.results)) return [];
    return data.results.filter(isJamendoTrack).map(jamendoTrackToSong);
  },
};
