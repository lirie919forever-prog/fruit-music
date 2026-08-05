import type { MusicProvider } from './types';
import { providerFetch } from './errors';
import { safeCoverArt } from '@/lib/coverArt';
import type { Album, Artist, Song } from '@/types/music';

const PROXY_BASE = '/api/music/deezer';
const PREVIEW_DURATION_SECONDS = 30;
const PREVIEW_LICENSE = '30-second preview';
const DEEZER_TERMS_URL = 'https://www.deezer.com/legal/cgu';
const BROWSE_SEEDS = ['pop', 'rock', 'hip-hop', 'electronic'];

interface DeezerArtist {
  id?: number;
  name?: string;
  link?: string;
  picture_xl?: string;
  picture_big?: string;
  nb_album?: number;
}

interface DeezerAlbum {
  id?: number;
  title?: string;
  link?: string;
  cover_xl?: string;
  cover_big?: string;
  release_date?: string;
  nb_tracks?: number;
  duration?: number;
  genre_id?: number;
  artist?: DeezerArtist;
}

export interface DeezerTrack {
  id?: number;
  readable?: boolean;
  title?: string;
  duration?: number;
  rank?: number;
  preview?: string;
  link?: string;
  position?: number;
  release_date?: string;
  artist?: DeezerArtist;
  album?: DeezerAlbum | null;
}

interface DeezerResponse<T> {
  data?: T[];
}

function isDeezerId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function rawId(value: string, prefix: string): string | null {
  const id = value.replace(prefix, '');
  return /^[1-9]\d{0,15}$/.test(id) ? id : null;
}

function releaseYear(value: string | undefined): number {
  return value ? Number(value.slice(0, 4)) || 0 : 0;
}

function publicUrl(value: string | undefined, fallback: string): string {
  return typeof value === 'string' && value.startsWith('https://') ? value : fallback;
}

function artwork(value: string | undefined): string {
  return safeCoverArt(value);
}

function isPlayableTrack(track: DeezerTrack, albumOverride?: DeezerAlbum): track is DeezerTrack & { id: number } {
  const album = track.album || albumOverride;
  return (
    isDeezerId(track.id) &&
    track.readable !== false &&
    Boolean(track.title) &&
    typeof track.preview === 'string' &&
    track.preview.startsWith('https://') &&
    isDeezerId(track.artist?.id) &&
    Boolean(track.artist?.name) &&
    isDeezerId(album?.id) &&
    Boolean(album?.title)
  );
}

/** Deezer's duration is the full recording, while its official preview is 30 seconds. */
export function deezerTrackToSong(track: DeezerTrack, index = 0, albumOverride?: DeezerAlbum): Song | null {
  if (!isPlayableTrack(track, albumOverride)) return null;
  const album = track.album || albumOverride!;
  const artist = track.artist!;
  const id = String(track.id);
  const artistId = String(artist.id);
  const albumId = String(album.id);
  const sourceUrl = publicUrl(track.link, `https://www.deezer.com/track/${id}`);
  const recordingDuration =
    typeof track.duration === 'number' && Number.isFinite(track.duration) && track.duration > 0
      ? Math.round(track.duration)
      : undefined;

  return {
    id: `deezer-${id}`,
    title: track.title!,
    artist: artist.name!,
    artistId: `deezer-artist-${artistId}`,
    album: album.title!,
    albumId: `deezer-album-${albumId}`,
    coverArt: artwork(album.cover_xl || album.cover_big),
    duration: PREVIEW_DURATION_SECONDS,
    ...(recordingDuration ? { recordingDuration } : {}),
    track: track.position ?? index + 1,
    year: releaseYear(album.release_date || track.release_date),
    genre: '',
    path: `${PROXY_BASE}/stream/${id}`,
    bitRate: 0,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: 0,
    provider: 'Deezer Preview',
    sourceUrl,
    creatorUrl: publicUrl(artist.link, `https://www.deezer.com/artist/${artistId}`),
    licenseName: PREVIEW_LICENSE,
    licenseUrl: DEEZER_TERMS_URL,
    attributionUrl: sourceUrl,
    metadataVerified: true,
  };
}

function deezerAlbumToAlbum(album: DeezerAlbum): Album | null {
  if (!isDeezerId(album.id) || !album.title || !isDeezerId(album.artist?.id) || !album.artist.name) return null;
  return {
    id: `deezer-album-${album.id}`,
    name: album.title,
    artist: album.artist.name,
    artistId: `deezer-artist-${album.artist.id}`,
    coverArt: artwork(album.cover_xl || album.cover_big),
    songCount: album.nb_tracks ?? 0,
    duration: Number.isFinite(album.duration) ? Math.max(0, Math.round(album.duration!)) : 0,
    year: releaseYear(album.release_date),
    genre: '',
  };
}

function deezerArtistToArtist(artist: DeezerArtist): Artist | null {
  if (!isDeezerId(artist.id) || !artist.name) return null;
  return {
    id: `deezer-artist-${artist.id}`,
    name: artist.name,
    coverArt: artwork(artist.picture_xl || artist.picture_big),
    albumCount: artist.nb_album ?? 0,
  };
}

function dataItems<T>(payload: DeezerResponse<T>): T[] {
  return Array.isArray(payload?.data) ? payload.data : [];
}

function songsFrom(tracks: DeezerTrack[], album?: DeezerAlbum): Song[] {
  return tracks
    .map((track, index) => deezerTrackToSong(track, index, album))
    .filter((song): song is Song => song !== null);
}

async function deezerFetch<T>(
  resource: 'tracks' | 'albums' | 'artists',
  params: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<DeezerResponse<T>> {
  return providerFetch<DeezerResponse<T>>('Deezer Preview', resource, `${PROXY_BASE}/${resource}`, params, signal);
}

async function browseAlbums(signal?: AbortSignal): Promise<Album[]> {
  const settled = await Promise.allSettled(
    BROWSE_SEEDS.map((seed) => deezerFetch<DeezerAlbum>('albums', { q: seed, limit: '20' }, signal)),
  );
  const seen = new Set<string>();
  const albums: Album[] = [];
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const album of dataItems(result.value)) {
      const mapped = deezerAlbumToAlbum(album);
      if (!mapped || seen.has(mapped.id)) continue;
      seen.add(mapped.id);
      albums.push(mapped);
    }
  }
  return albums;
}

async function browseArtists(signal?: AbortSignal): Promise<Artist[]> {
  const settled = await Promise.allSettled(
    BROWSE_SEEDS.map((seed) => deezerFetch<DeezerArtist>('artists', { q: seed, limit: '20' }, signal)),
  );
  const seen = new Set<string>();
  const artists: Artist[] = [];
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const artist of dataItems(result.value)) {
      const mapped = deezerArtistToArtist(artist);
      if (!mapped || seen.has(mapped.id)) continue;
      seen.add(mapped.id);
      artists.push(mapped);
    }
  }
  return artists;
}

type DeezerProvider = MusicProvider &
  Required<
    Pick<
      MusicProvider,
      'getAlbumById' | 'getArtistById' | 'getSongById' | 'searchAlbums' | 'searchArtists' | 'getArtistAlbums'
    >
  >;

export const deezerProvider: DeezerProvider = {
  async search(query: string, signal?: AbortSignal): Promise<Song[]> {
    if (!query.trim()) return [];
    const data = await deezerFetch<DeezerTrack>('tracks', { q: query, limit: '40' }, signal);
    return songsFrom(dataItems(data));
  },

  async getSongsByTag(tag: string, limit = 50, signal?: AbortSignal): Promise<Song[]> {
    if (!tag.trim()) return [];
    const data = await deezerFetch<DeezerTrack>('tracks', { q: tag, limit: String(limit) }, signal);
    return songsFrom(dataItems(data));
  },

  async getTrending(limit = 50, signal?: AbortSignal): Promise<Song[]> {
    const data = await deezerFetch<DeezerTrack>('tracks', { chart: '1', limit: String(limit) }, signal);
    return songsFrom(dataItems(data));
  },

  getAlbums(signal?: AbortSignal): Promise<Album[]> {
    return browseAlbums(signal);
  },

  async searchAlbums(query: string, signal?: AbortSignal): Promise<Album[]> {
    if (!query.trim()) return [];
    const data = await deezerFetch<DeezerAlbum>('albums', { q: query, limit: '24' }, signal);
    return dataItems(data)
      .map(deezerAlbumToAlbum)
      .filter((album): album is Album => album !== null);
  },

  async getAlbumById(albumId: string, signal?: AbortSignal): Promise<Album | null> {
    const id = rawId(albumId, 'deezer-album-');
    if (!id) return null;
    const data = await deezerFetch<DeezerAlbum>('albums', { id }, signal);
    return (
      dataItems(data)
        .map(deezerAlbumToAlbum)
        .find((album): album is Album => album !== null) ?? null
    );
  },

  async getAlbumSongs(albumId: string, signal?: AbortSignal): Promise<Song[]> {
    const id = rawId(albumId, 'deezer-album-');
    if (!id) return [];
    const [tracks, album] = await Promise.all([
      deezerFetch<DeezerTrack>('tracks', { album_id: id, limit: '100' }, signal),
      deezerFetch<DeezerAlbum>('albums', { id }, signal),
    ]);
    return songsFrom(dataItems(tracks), dataItems(album)[0]).sort((left, right) => left.track - right.track);
  },

  getArtists(signal?: AbortSignal): Promise<Artist[]> {
    return browseArtists(signal);
  },

  async searchArtists(query: string, signal?: AbortSignal): Promise<Artist[]> {
    if (!query.trim()) return [];
    const data = await deezerFetch<DeezerArtist>('artists', { q: query, limit: '24' }, signal);
    return dataItems(data)
      .map(deezerArtistToArtist)
      .filter((artist): artist is Artist => artist !== null);
  },

  async getArtistById(artistId: string, signal?: AbortSignal): Promise<Artist | null> {
    const id = rawId(artistId, 'deezer-artist-');
    if (!id) return null;
    const data = await deezerFetch<DeezerArtist>('artists', { id }, signal);
    return (
      dataItems(data)
        .map(deezerArtistToArtist)
        .find((artist): artist is Artist => artist !== null) ?? null
    );
  },

  async getArtistSongs(artistId: string, signal?: AbortSignal): Promise<Song[]> {
    const id = rawId(artistId, 'deezer-artist-');
    if (!id) return [];
    const data = await deezerFetch<DeezerTrack>('tracks', { artist_id: id, limit: '50' }, signal);
    return songsFrom(dataItems(data));
  },

  async getArtistAlbums(artistId: string, signal?: AbortSignal): Promise<Album[]> {
    const id = rawId(artistId, 'deezer-artist-');
    if (!id) return [];
    const data = await deezerFetch<DeezerAlbum>('albums', { artist_id: id, limit: '50' }, signal);
    return dataItems(data)
      .map(deezerAlbumToAlbum)
      .filter((album): album is Album => album !== null)
      .sort((left, right) => right.year - left.year);
  },

  async getSongById(songId: string, signal?: AbortSignal): Promise<Song | null> {
    const id = rawId(songId, 'deezer-');
    if (!id) return null;
    const data = await deezerFetch<DeezerTrack>('tracks', { id }, signal);
    return songsFrom(dataItems(data))[0] ?? null;
  },

  async getStreamUrl(song: Song): Promise<string> {
    return song.path;
  },
};
