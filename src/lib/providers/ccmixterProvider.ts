import type { MusicProvider } from './types';
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

async function ccFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  return providerFetch<T>('ccMixter', path.split('/').pop() || 'request', path, params);
}

function parseDuration(ps?: string): number {
  if (!ps) return 0;
  const parts = ps.split(':').map(Number);
  if (parts.length === 2) return (parts[0] || 0) * 60 + (parts[1] || 0);
  if (parts.length === 3) return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  return 0;
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
  if (!mp3File?.download_url || !license || !u.upload_id || !u.upload_name || !u.user_name) return null;

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
    duration: parseDuration(mp3File.file_format_info?.ps),
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

export const ccmixterProvider: MusicProvider = {
  async getSongsByTag(tag: string, limit = 50): Promise<Song[]> {
    const data = await ccFetch<{ results: CCMixterUpload[] }>(`${PROXY_BASE}/tracks`, {
      tags: tag,
      limit: String(limit),
    });
    if (!Array.isArray(data?.results)) return [];
    return data.results.map(uploadToSong).filter((s): s is Song => s !== null);
  },

  async getTrending(limit = 50): Promise<Song[]> {
    return this.getSongsByTag('remix', limit);
  },

  async getAlbums(): Promise<Album[]> {
    const songs = await this.getSongsByTag('remix', 100);
    const seen = new Map<string, Album>();
    for (const s of songs) {
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
    return Array.from(seen.values());
  },

  async getArtists(): Promise<Artist[]> {
    const songs = await this.getSongsByTag('remix', 100);
    const seen = new Map<string, Artist>();
    for (const s of songs) {
      if (!seen.has(s.artistId)) {
        seen.set(s.artistId, {
          id: s.artistId,
          name: s.artist,
          coverArt: s.coverArt,
          albumCount: 1,
        });
      }
    }
    return Array.from(seen.values());
  },

  async getAlbumSongs(albumId: string): Promise<Song[]> {
    const userName = albumId.replace('ccmixter-album-', '');
    return this.getArtistSongs(`ccmixter-artist-${userName}`);
  },

  async getArtistSongs(artistId: string): Promise<Song[]> {
    const userName = artistId.replace('ccmixter-artist-', '');
    const data = await ccFetch<{ results: CCMixterUpload[] }>(`${PROXY_BASE}/tracks`, {
      user_name: userName,
      limit: '50',
    });
    if (!Array.isArray(data?.results)) return [];
    return data.results.map(uploadToSong).filter((s): s is Song => s !== null);
  },

  async search(query: string): Promise<Song[]> {
    const data = await ccFetch<{ results: CCMixterUpload[] }>(`${PROXY_BASE}/tracks`, {
      search: query,
      limit: '30',
    });
    if (!Array.isArray(data?.results)) return [];
    return data.results.map(uploadToSong).filter((s): s is Song => s !== null);
  },

  async getStreamUrl(song: Song): Promise<string> {
    return song.path;
  },
};
