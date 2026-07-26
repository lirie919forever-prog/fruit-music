import type { MusicProvider, ProviderCatalogResult } from './types';
import { providerFetch } from './errors';
import { createDeterministicCover } from '@/lib/coverArt';
import { normalizeCreativeCommonsLicense } from '@/lib/licenses';
import type { Album, Artist, Song } from '@/types/music';

const PROXY_BASE = '/api/music/ccmixter';

interface CCMixterFile {
  file_id?: number;
  file_name?: string;
  file_format_info?: { mime_type?: string; ps?: string };
  download_url?: string;
  file_rawsize?: number;
}

interface CCMixterUpload {
  upload_id: number;
  upload_name: string;
  user_real_name: string;
  user_name: string;
  upload_tags?: string;
  upload_extra?: { cover?: string; relative_dir?: string };
  upload_pic?: string;
  files?: CCMixterFile[];
  license_name?: string;
  license_url?: string;
  file_page_url?: string;
}

type CCMixterProvider = MusicProvider & Required<Pick<MusicProvider,
  | 'getAlbumsWithStatus'
  | 'getArtistsWithStatus'
  | 'getSongsByTagWithStatus'
  | 'getTrendingWithStatus'
  | 'searchWithStatus'
  | 'getAlbumById'
  | 'getArtistById'
>>;

async function ccFetch<T>(path: string, params: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
  return providerFetch<T>('ccMixter', path.split('/').pop() || 'request', path, params, signal);
}

function parseDuration(ps?: string): number {
  if (!ps) return 0;
  const parts = ps.split(':').map(Number);
  if (
    !parts.every(Number.isFinite) ||
    parts.some((part) => part < 0) ||
    parts.length < 2 ||
    parts.length > 3
  ) {
    return 0;
  }
  if (parts.slice(1).some((part) => part >= 60)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function uploadToSong(u: CCMixterUpload): Song | null {
  // Only expose verified MP3 files with HTTPS URLs. ccMixter also returns
  // previews and lossless files which the browser audio element cannot rely on.
  const mp3File = u.files?.find((file) => {
    if (file.file_format_info?.mime_type !== 'audio/mpeg' || !file.download_url) return false;
    try {
      return new URL(file.download_url).protocol === 'https:';
    } catch {
      return false;
    }
  });
  const license = normalizeCreativeCommonsLicense(u.license_url);
  const duration = parseDuration(mp3File?.file_format_info?.ps);
  if (
    !mp3File?.download_url ||
    !license ||
    !u.upload_id ||
    !u.upload_name ||
    !u.user_name ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return null;
  }

  const coverArt = u.upload_extra?.cover || u.upload_pic || createDeterministicCover(u.user_name || u.upload_name || 'cc', 40);
  const tags = u.upload_tags?.split(',').map(t => t.trim()).filter(Boolean) || [];
  const genre = tags.find(t => !['media', 'remix', 'ccplus', 'audio', 'mp3', 'flac', 'non_commercial'].includes(t)) || '';

  return {
    id: `ccmixter-${u.upload_id}`,
    title: u.upload_name || 'Unknown',
    artist: u.user_real_name || u.user_name || 'Unknown',
    artistId: `ccmixter-artist-${u.user_name}`,
    album: 'ccMixter',
    albumId: `ccmixter-album-${u.user_name}`,
    coverArt,
    duration,
    track: 0,
    year: 0,
    genre,
    path: `${PROXY_BASE}/stream/${u.upload_id}`,
    bitRate: 0,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: mp3File.file_rawsize || 0,
    provider: 'ccMixter',
    sourceUrl: u.file_page_url || `https://ccmixter.org/files/${encodeURIComponent(u.user_name)}/${u.upload_id}`,
    creatorUrl: `https://ccmixter.org/people/${encodeURIComponent(u.user_name)}`,
    licenseName: license.name,
    licenseUrl: license.url,
    attributionUrl: u.file_page_url || `https://ccmixter.org/files/${encodeURIComponent(u.user_name)}/${u.upload_id}`,
    metadataVerified: true,
  };
}

export const ccmixterProvider: CCMixterProvider = {
  getSongsByTag(tag: string, limit = 50, signal?: AbortSignal): Promise<Song[]> {
    return this.getSongsByTagWithStatus(tag, limit, signal).then((result) => result.results);
  },

  async getSongsByTagWithStatus(tag: string, limit = 50, signal?: AbortSignal): Promise<ProviderCatalogResult<Song>> {
    const data = await ccFetch<{ results: CCMixterUpload[]; degraded?: boolean }>(`${PROXY_BASE}/tracks`, {
      tags: tag,
      limit: String(limit),
    }, signal);
    const results = Array.isArray(data?.results)
      ? data.results.map(uploadToSong).filter((s): s is Song => s !== null)
      : [];
    return { results, degraded: Boolean(data?.degraded) };
  },

  async getTrending(limit = 50, signal?: AbortSignal): Promise<Song[]> {
    const result = await this.getTrendingWithStatus(limit, signal);
    return result.results;
  },

  getTrendingWithStatus(limit = 50, signal?: AbortSignal): Promise<ProviderCatalogResult<Song>> {
    return this.getSongsByTagWithStatus('remix', limit, signal);
  },

  async getAlbumsWithStatus(signal?: AbortSignal): Promise<ProviderCatalogResult<Album>> {
    const catalog = await this.getSongsByTagWithStatus('remix', 100, signal);
    const seen = new Map<string, Album>();
    for (const s of catalog.results) {
      if (!seen.has(s.artistId)) {
        seen.set(s.artistId, {
          id: s.albumId,
          name: `${s.artist}'s Tracks`,
          artist: s.artist,
          artistId: s.artistId,
          coverArt: s.coverArt,
          songCount: 0,
          duration: 0,
          year: 0,
          genre: s.genre,
        });
      }
      const album = seen.get(s.artistId)!;
      album.songCount++;
      album.duration += s.duration;
    }
    return { results: Array.from(seen.values()), degraded: catalog.degraded };
  },

  async getAlbums(signal?: AbortSignal): Promise<Album[]> {
    const result = await this.getAlbumsWithStatus(signal);
    return result.results;
  },

  async getArtistsWithStatus(signal?: AbortSignal): Promise<ProviderCatalogResult<Artist>> {
    const catalog = await this.getSongsByTagWithStatus('remix', 100, signal);
    const seen = new Map<string, Artist>();
    for (const s of catalog.results) {
      if (!seen.has(s.artistId)) {
        seen.set(s.artistId, {
          id: s.artistId,
          name: s.artist,
          coverArt: s.coverArt,
          albumCount: 1,
        });
      }
    }
    return { results: Array.from(seen.values()), degraded: catalog.degraded };
  },

  async getArtists(signal?: AbortSignal): Promise<Artist[]> {
    const result = await this.getArtistsWithStatus(signal);
    return result.results;
  },

  // ccMixter has no album records: an "album" is a creator's track collection,
  // so a deep link resolves by re-querying that creator rather than by scanning
  // the tag-derived catalog page, which only covers recent remix uploads.
  async getAlbumById(albumId: string, signal?: AbortSignal): Promise<Album | null> {
    const userName = albumId.replace('ccmixter-album-', '');
    if (!userName) return null;
    const songs = await this.getArtistSongs(`ccmixter-artist-${userName}`, signal);
    if (!songs.length) return null;
    return {
      id: albumId,
      name: `${songs[0].artist}'s Tracks`,
      artist: songs[0].artist,
      artistId: songs[0].artistId,
      coverArt: songs[0].coverArt,
      songCount: songs.length,
      duration: songs.reduce((total, song) => total + song.duration, 0),
      year: 0,
      genre: songs[0].genre,
    };
  },

  async getArtistById(artistId: string, signal?: AbortSignal): Promise<Artist | null> {
    const userName = artistId.replace('ccmixter-artist-', '');
    if (!userName) return null;
    const songs = await this.getArtistSongs(artistId, signal);
    if (!songs.length) return null;
    return {
      id: artistId,
      name: songs[0].artist,
      coverArt: songs[0].coverArt,
      albumCount: 1,
    };
  },

  async getAlbumSongs(albumId: string, signal?: AbortSignal): Promise<Song[]> {
    const userName = albumId.replace('ccmixter-album-', '');
    return this.getArtistSongs(`ccmixter-artist-${userName}`, signal);
  },

  async getArtistSongs(artistId: string, signal?: AbortSignal): Promise<Song[]> {
    const userName = artistId.replace('ccmixter-artist-', '');
    const data = await ccFetch<{ results: CCMixterUpload[] }>(`${PROXY_BASE}/tracks`, {
      user_name: userName,
      limit: '50',
    }, signal);
    if (!Array.isArray(data?.results)) return [];
    return data.results.map(uploadToSong).filter((s): s is Song => s !== null);
  },

  async searchWithStatus(query: string, signal?: AbortSignal): Promise<ProviderCatalogResult<Song>> {
    const data = await ccFetch<{ results: CCMixterUpload[]; degraded?: boolean }>(`${PROXY_BASE}/tracks`, {
      search: query,
      limit: '30',
    }, signal);
    const results = Array.isArray(data?.results)
      ? data.results.map(uploadToSong).filter((s): s is Song => s !== null)
      : [];
    return { results, degraded: Boolean(data?.degraded) };
  },

  async search(query: string, signal?: AbortSignal): Promise<Song[]> {
    const result = await this.searchWithStatus(query, signal);
    return result.results;
  },

  async getStreamUrl(song: Song): Promise<string> {
    return song.path;
  },
};
