import type { MusicProvider } from './types';
import { providerFetch } from './errors';
import { createDeterministicCover } from '@/lib/coverArt';
import type { Album, Artist, Song } from '@/types/music';

const PROXY_BASE = '/api/music/audius';
const AUDIOUS_ORIGIN = 'https://audius.co';
const AUDIOUS_API_ORIGIN = 'https://api.audius.co';
const AUDIOUS_TERMS_URL = 'https://audius.co/terms-of-service';
const SINGLES_PREFIX = 'singles-';
let streamRequestSequence = 0;

interface AudiusUser {
  id?: string;
  name?: string;
  handle?: string;
  permalink?: string;
  album_count?: number;
  is_available?: boolean;
  is_deactivated?: boolean;
}

interface AudiusAlbumBacklink {
  id?: string;
  playlist_id?: number;
  title?: string;
  playlist_name?: string;
}

export interface AudiusTrack {
  id?: string;
  title?: string;
  duration?: number;
  genre?: string;
  release_date?: string;
  created_at?: string;
  is_available?: boolean;
  is_streamable?: boolean;
  is_stream_gated?: boolean;
  permalink?: string;
  user?: AudiusUser;
  album_backlink?: AudiusAlbumBacklink | null;
}

interface AudiusAlbum {
  id?: string;
  playlist_name?: string;
  is_album?: boolean;
  track_count?: number;
  created_at?: string;
  user?: AudiusUser;
}

interface AudiusResponse<T> {
  data?: T | T[];
}

function isAudiusId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function rawId(value: string, prefix: string): string | null {
  const id = value.replace(prefix, '');
  return isAudiusId(id) ? id : null;
}

function year(value: string | undefined): number {
  return value ? Number(value.slice(0, 4)) || 0 : 0;
}

function dataItems<T>(payload: AudiusResponse<T>): T[] {
  if (Array.isArray(payload?.data)) return payload.data;
  return payload?.data === undefined || payload.data === null ? [] : [payload.data];
}

function pageUrl(path: string | undefined, fallback: string): string {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return fallback;
  try {
    const url = new URL(path, AUDIOUS_ORIGIN);
    return url.origin === AUDIOUS_ORIGIN ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function artistUrl(user: AudiusUser): string {
  const fallback = user.handle ? `${AUDIOUS_ORIGIN}/${encodeURIComponent(user.handle)}` : AUDIOUS_ORIGIN;
  return pageUrl(user.permalink, fallback);
}

function albumIdFor(track: AudiusTrack, user: AudiusUser): string {
  const linkedId = track.album_backlink?.id;
  return isAudiusId(linkedId) ? `audius-album-${linkedId}` : `audius-album-${SINGLES_PREFIX}${user.id}`;
}

function albumNameFor(track: AudiusTrack): string {
  return track.album_backlink?.title || track.album_backlink?.playlist_name || 'Audius singles';
}

function isPlayableTrack(track: AudiusTrack): track is AudiusTrack & { id: string; title: string; user: AudiusUser } {
  return (
    isAudiusId(track.id) &&
    Boolean(track.title) &&
    Number.isFinite(track.duration) &&
    (track.duration ?? 0) > 0 &&
    track.is_available !== false &&
    track.is_streamable === true &&
    track.is_stream_gated !== true &&
    isAudiusId(track.user?.id) &&
    Boolean(track.user?.name) &&
    track.user.is_available !== false &&
    track.user.is_deactivated !== true
  );
}

function streamUrl(trackId: string, requestNonce?: string): string {
  const url = new URL(`/v1/tracks/${encodeURIComponent(trackId)}/stream`, AUDIOUS_API_ORIGIN);
  url.searchParams.set('app_name', 'marea');
  if (requestNonce) url.searchParams.set('marea_request', requestNonce);
  return url.toString();
}

/** Audius routes stream playback through its own API, which selects the live creator node in the browser. */
export function audiusTrackToSong(track: AudiusTrack, index = 0): Song | null {
  if (!isPlayableTrack(track)) return null;
  const user = track.user;
  const sourceUrl = pageUrl(track.permalink, artistUrl(user));

  return {
    id: `audius-${track.id}`,
    title: track.title,
    artist: user.name!,
    artistId: `audius-artist-${user.id}`,
    album: albumNameFor(track),
    albumId: albumIdFor(track, user),
    // Artwork and audio are served from a changing validator mesh. The stream
    // stays on Audius's stable API endpoint, while a deterministic cover avoids
    // granting the image optimizer a broad, mutable node-host allowlist.
    coverArt: createDeterministicCover(`${user.name}:${track.title}`, 175),
    duration: Math.round(track.duration!),
    track: index + 1,
    year: year(track.release_date || track.created_at),
    genre: track.genre || '',
    path: streamUrl(track.id),
    bitRate: 0,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: 0,
    provider: 'Audius',
    sourceUrl,
    creatorUrl: artistUrl(user),
    licenseName: 'Creator-published stream',
    licenseUrl: AUDIOUS_TERMS_URL,
    attributionUrl: sourceUrl,
    metadataVerified: true,
  };
}

function audiusAlbumToAlbum(album: AudiusAlbum): Album | null {
  if (
    !isAudiusId(album.id) ||
    album.is_album !== true ||
    !album.playlist_name ||
    !isAudiusId(album.user?.id) ||
    !album.user.name
  ) {
    return null;
  }
  return {
    id: `audius-album-${album.id}`,
    name: album.playlist_name,
    artist: album.user.name,
    artistId: `audius-artist-${album.user.id}`,
    coverArt: createDeterministicCover(`${album.user.name}:${album.playlist_name}`, 175),
    songCount: album.track_count ?? 0,
    duration: 0,
    year: year(album.created_at),
    genre: '',
  };
}

function audiusUserToArtist(user: AudiusUser): Artist | null {
  if (!isAudiusId(user.id) || !user.name || user.is_available === false || user.is_deactivated === true) return null;
  return {
    id: `audius-artist-${user.id}`,
    name: user.name,
    coverArt: createDeterministicCover(user.name, 175),
    albumCount: user.album_count ?? 0,
  };
}

function songsFrom(tracks: AudiusTrack[]): Song[] {
  return tracks.map(audiusTrackToSong).filter((song): song is Song => song !== null);
}

async function audiusFetch<T>(
  resource: 'tracks' | 'albums' | 'artists',
  params: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<AudiusResponse<T>> {
  return providerFetch<AudiusResponse<T>>('Audius', resource, `${PROXY_BASE}/${resource}`, params, signal);
}

function parseAlbumId(albumId: string): { kind: 'album' | 'singles'; id: string } | null {
  const raw = albumId.replace('audius-album-', '');
  if (raw.startsWith(SINGLES_PREFIX)) {
    const artistId = raw.slice(SINGLES_PREFIX.length);
    return isAudiusId(artistId) ? { kind: 'singles', id: artistId } : null;
  }
  return isAudiusId(raw) ? { kind: 'album', id: raw } : null;
}

type AudiusProvider = MusicProvider &
  Required<
    Pick<
      MusicProvider,
      'getAlbumById' | 'getArtistById' | 'getSongById' | 'searchAlbums' | 'searchArtists' | 'getArtistAlbums'
    >
  >;

export const audiusProvider: AudiusProvider = {
  async search(query: string, signal?: AbortSignal): Promise<Song[]> {
    if (!query.trim()) return [];
    const data = await audiusFetch<AudiusTrack>('tracks', { q: query, limit: '40' }, signal);
    return songsFrom(dataItems(data));
  },

  async getSongsByTag(tag: string, limit = 50, signal?: AbortSignal): Promise<Song[]> {
    if (!tag.trim()) return [];
    const data = await audiusFetch<AudiusTrack>('tracks', { q: tag, limit: String(limit) }, signal);
    return songsFrom(dataItems(data));
  },

  async getTrending(limit = 50, signal?: AbortSignal): Promise<Song[]> {
    const data = await audiusFetch<AudiusTrack>('tracks', { trending: '1', limit: String(limit) }, signal);
    return songsFrom(dataItems(data));
  },

  async getAlbums(signal?: AbortSignal): Promise<Album[]> {
    const data = await audiusFetch<AudiusAlbum>('albums', { trending: '1', limit: '40' }, signal);
    return dataItems(data)
      .map(audiusAlbumToAlbum)
      .filter((album): album is Album => album !== null);
  },

  async searchAlbums(query: string, signal?: AbortSignal): Promise<Album[]> {
    if (!query.trim()) return [];
    const data = await audiusFetch<AudiusAlbum>('albums', { q: query, limit: '24' }, signal);
    return dataItems(data)
      .map(audiusAlbumToAlbum)
      .filter((album): album is Album => album !== null);
  },

  async getAlbumById(albumId: string, signal?: AbortSignal): Promise<Album | null> {
    const parsed = parseAlbumId(albumId);
    if (!parsed) return null;
    if (parsed.kind === 'singles') {
      const [artistData, tracksData] = await Promise.all([
        audiusFetch<AudiusUser>('artists', { id: parsed.id }, signal),
        audiusFetch<AudiusTrack>('tracks', { artist_id: parsed.id, limit: '50' }, signal),
      ]);
      const artist = dataItems(artistData)
        .map(audiusUserToArtist)
        .find((item): item is Artist => item !== null);
      if (!artist) return null;
      const songs = songsFrom(dataItems(tracksData));
      return {
        id: albumId,
        name: 'Audius singles',
        artist: artist.name,
        artistId: artist.id,
        coverArt: artist.coverArt,
        songCount: songs.length,
        duration: songs.reduce((total, song) => total + song.duration, 0),
        year: songs[0]?.year ?? 0,
        genre: songs[0]?.genre ?? '',
      };
    }
    const data = await audiusFetch<AudiusAlbum>('albums', { id: parsed.id }, signal);
    return (
      dataItems(data)
        .map(audiusAlbumToAlbum)
        .find((album): album is Album => album !== null) ?? null
    );
  },

  async getAlbumSongs(albumId: string, signal?: AbortSignal): Promise<Song[]> {
    const parsed = parseAlbumId(albumId);
    if (!parsed) return [];
    if (parsed.kind === 'singles') return this.getArtistSongs(`audius-artist-${parsed.id}`, signal);
    const data = await audiusFetch<AudiusTrack>('tracks', { album_id: parsed.id, limit: '100' }, signal);
    return songsFrom(dataItems(data));
  },

  async getArtists(signal?: AbortSignal): Promise<Artist[]> {
    const data = await audiusFetch<AudiusTrack>('tracks', { trending: '1', limit: '50' }, signal);
    const seen = new Set<string>();
    return dataItems(data)
      .map((track) => (track.user ? audiusUserToArtist(track.user) : null))
      .filter((artist): artist is Artist => artist !== null)
      .filter((artist) => {
        if (seen.has(artist.id)) return false;
        seen.add(artist.id);
        return true;
      });
  },

  async searchArtists(query: string, signal?: AbortSignal): Promise<Artist[]> {
    if (!query.trim()) return [];
    const data = await audiusFetch<AudiusUser>('artists', { q: query, limit: '24' }, signal);
    return dataItems(data)
      .map(audiusUserToArtist)
      .filter((artist): artist is Artist => artist !== null);
  },

  async getArtistById(artistId: string, signal?: AbortSignal): Promise<Artist | null> {
    const id = rawId(artistId, 'audius-artist-');
    if (!id) return null;
    const data = await audiusFetch<AudiusUser>('artists', { id }, signal);
    return (
      dataItems(data)
        .map(audiusUserToArtist)
        .find((artist): artist is Artist => artist !== null) ?? null
    );
  },

  async getArtistSongs(artistId: string, signal?: AbortSignal): Promise<Song[]> {
    const id = rawId(artistId, 'audius-artist-');
    if (!id) return [];
    const data = await audiusFetch<AudiusTrack>('tracks', { artist_id: id, limit: '100' }, signal);
    return songsFrom(dataItems(data));
  },

  async getArtistAlbums(artistId: string, signal?: AbortSignal): Promise<Album[]> {
    const id = rawId(artistId, 'audius-artist-');
    if (!id) return [];
    const data = await audiusFetch<AudiusAlbum>('albums', { artist_id: id, limit: '50' }, signal);
    return dataItems(data)
      .map(audiusAlbumToAlbum)
      .filter((album): album is Album => album !== null)
      .sort((left, right) => right.year - left.year);
  },

  async getSongById(songId: string, signal?: AbortSignal): Promise<Song | null> {
    const id = rawId(songId, 'audius-');
    if (!id) return null;
    const data = await audiusFetch<AudiusTrack>('tracks', { id }, signal);
    return songsFrom(dataItems(data))[0] ?? null;
  },

  async getStreamUrl(song: Song): Promise<string> {
    const trackId = rawId(song.id, 'audius-');
    if (!trackId) return song.path;
    // Audius's public stream endpoint redirects to a short-lived signed
    // validator URL. The endpoint itself can be cached, leaving a retry stuck
    // on an expired redirect, so each play attempt gets a distinct cache key.
    streamRequestSequence += 1;
    return streamUrl(trackId, `${Date.now().toString(36)}-${streamRequestSequence}`);
  },
};
