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

async function archiveFetch<T>(path: string, params: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
  return providerFetch<T>('Archive', path.split('/').pop() || 'request', path, params, signal);
}

function isArchiveDoc(doc: ArchiveDoc): boolean {
  return Boolean(
    doc?.identifier &&
    doc.title &&
    doc.creator &&
    doc.filename &&
    Array.isArray(doc.subject) &&
    doc.streamUrl &&
    Number.isFinite(doc.duration) &&
    doc.duration > 0 &&
    Number.isFinite(doc.size) &&
    doc.size > 0 &&
    doc.contentType === 'audio/mpeg' &&
    doc.licenseName &&
    doc.licenseUrl &&
    doc.sourceUrl,
  );
}

function docToSong(doc: ArchiveDoc, index: number): Song {
  const genre = doc.subject[0] || '';
  const year = typeof doc.year === 'string' ? parseInt(doc.year) || 0 : doc.year || 0;

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
  async getSongsByTag(tag: string, limit = 50, signal?: AbortSignal): Promise<Song[]> {
    const data = await archiveFetch<{ results: ArchiveDoc[] }>(
      `${PROXY_BASE}/tracks`,
      {
        subject: tag,
        limit: String(limit),
      },
      signal,
    );
    if (!Array.isArray(data?.results)) return [];
    return data.results.filter(isArchiveDoc).map(docToSong);
  },

  async getTrending(limit = 50, signal?: AbortSignal): Promise<Song[]> {
    return this.getSongsByTag('classical', limit, signal);
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

  async getArtistSongs(artistId: string, signal?: AbortSignal): Promise<Song[]> {
    const creator = decodeURIComponent(artistId.replace('archive-artist-', ''));
    const data = await archiveFetch<{ results: ArchiveDoc[] }>(
      `${PROXY_BASE}/tracks`,
      {
        creator,
        limit: '20',
      },
      signal,
    );
    if (!Array.isArray(data?.results)) return [];
    return data.results.filter(isArchiveDoc).map(docToSong);
  },

  async search(query: string, signal?: AbortSignal): Promise<Song[]> {
    // Archive resolves one metadata request per result, so a large search page
    // costs more time than the federated search budget allows. A smaller page
    // keeps Archive contributing to results instead of always timing out.
    const data = await archiveFetch<{ results: ArchiveDoc[] }>(
      `${PROXY_BASE}/tracks`,
      {
        subject: query,
        limit: '10',
      },
      signal,
    );
    if (!Array.isArray(data?.results)) return [];
    return data.results.filter(isArchiveDoc).map(docToSong);
  },

  async getSongById(songId: string, signal?: AbortSignal): Promise<Song | null> {
    const encoded = songId.replace('archive-', '');
    const separator = encoded.indexOf('~');
    if (separator <= 0) return null;
    const identifier = encoded.slice(0, separator);
    const filename = decodeURIComponent(encoded.slice(separator + 1));
    const data = await archiveFetch<{ results: ArchiveDoc[] }>(
      `${PROXY_BASE}/tracks`,
      {
        identifier,
        filename,
        limit: '1',
      },
      signal,
    );
    const doc = Array.isArray(data?.results)
      ? data.results.find((item) => item.identifier === identifier && item.filename === filename)
      : undefined;
    return doc && isArchiveDoc(doc) ? docToSong(doc, 0) : null;
  },

  async getStreamUrl(song: Song): Promise<string> {
    return song.path;
  },
};
