import type { MusicProvider } from './types';
import { providerFetch } from './errors';
import { createDeterministicCover } from '@/lib/coverArt';
import type { Album, Artist, Song } from '@/types/music';

const PROXY_BASE = '/api/music/archive';

interface ArchiveDoc {
  identifier: string;
  title: string;
  creator: string;
  subject: string[];
  year?: number | string;
  filename: string;
  duration: number;
  size: number;
  bitRate: number;
  contentType: 'audio/mpeg';
  suffix: 'mp3';
  streamUrl: string;
  sourceUrl: string;
  creatorUrl: string;
  licenseName: string;
  licenseUrl: string;
  attributionUrl: string;
}

async function archiveFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  return providerFetch<T>('Archive', path.split('/').pop() || 'request', path, params);
}

function isArchiveDoc(doc: ArchiveDoc): boolean {
  return Boolean(doc?.identifier && doc.title && doc.creator && doc.streamUrl && doc.duration > 0 &&
    doc.size > 0 && doc.contentType === 'audio/mpeg' && doc.licenseName && doc.licenseUrl && doc.sourceUrl);
}

function docToSong(doc: ArchiveDoc, index: number): Song {
  const genre = doc.subject[0] || '';
  const year = typeof doc.year === 'string' ? parseInt(doc.year) || 0 : (doc.year || 0);

  return {
    id: `archive-${doc.identifier}~${encodeURIComponent(doc.filename)}`,
    title: doc.title,
    artist: doc.creator,
    artistId: `archive-artist-${encodeURIComponent(doc.creator)}`,
    album: 'Internet Archive',
    albumId: `archive-album-${encodeURIComponent(doc.identifier)}`,
    coverArt: createDeterministicCover(doc.creator),
    duration: doc.duration,
    track: index + 1,
    year,
    genre,
    path: doc.streamUrl,
    bitRate: doc.bitRate,
    contentType: doc.contentType,
    suffix: doc.suffix,
    size: doc.size,
    provider: 'Archive',
    sourceUrl: doc.sourceUrl,
    creatorUrl: doc.creatorUrl,
    licenseName: doc.licenseName,
    licenseUrl: doc.licenseUrl,
    attributionUrl: doc.attributionUrl,
    metadataVerified: true,
  };
}

export const archiveProvider: MusicProvider = {
  async getSongsByTag(tag: string, limit = 50): Promise<Song[]> {
    const data = await archiveFetch<{ results: ArchiveDoc[] }>(`${PROXY_BASE}/tracks`, {
      subject: tag,
      limit: String(limit),
      format: 'mp3',
    });
    if (!Array.isArray(data?.results)) return [];
    return data.results.filter(isArchiveDoc).map(docToSong);
  },

  async getTrending(limit = 50): Promise<Song[]> {
    return this.getSongsByTag('classical', limit);
  },

  async getAlbums(): Promise<Album[]> {
    return [];
  },

  async getArtists(): Promise<Artist[]> {
    return [];
  },

  async getAlbumSongs(): Promise<Song[]> {
    return [];
  },

  async getArtistSongs(artistId: string): Promise<Song[]> {
    const creator = decodeURIComponent(artistId.replace('archive-artist-', ''));
    const data = await archiveFetch<{ results: ArchiveDoc[] }>(`${PROXY_BASE}/tracks`, {
      creator,
      limit: '20',
    });
    if (!Array.isArray(data?.results)) return [];
    return data.results.filter(isArchiveDoc).map(docToSong);
  },

  async search(query: string): Promise<Song[]> {
    const data = await archiveFetch<{ results: ArchiveDoc[] }>(`${PROXY_BASE}/tracks`, {
      subject: query,
      limit: '30',
    });
    if (!Array.isArray(data?.results)) return [];
    return data.results.filter(isArchiveDoc).map(docToSong);
  },

  async getStreamUrl(song: Song): Promise<string> {
    return song.path;
  },
};
