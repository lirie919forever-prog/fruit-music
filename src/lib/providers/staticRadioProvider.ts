import type { MusicProvider } from './types';
import { createDeterministicCover } from '@/lib/coverArt';
import type { Album, Artist, MusicProviderName, Song } from '@/types/music';

export interface StaticRadioStation {
  readonly id: string;
  readonly title: string;
  /** Station operator shown to listeners when a curated provider has multiple broadcasters. */
  readonly artist?: string;
  readonly description: string;
  readonly genre: string;
  readonly streamUrl: string;
  readonly bitRate: number;
  readonly contentType?: string;
  readonly suffix?: string;
  readonly sourceUrl?: string;
}

interface StaticRadioProviderConfig {
  readonly name: MusicProviderName;
  readonly idPrefix: string;
  readonly artist: string;
  readonly origin: string;
  readonly coverKey: string;
  readonly stations: readonly StaticRadioStation[];
}

type StaticRadioProvider = MusicProvider &
  Required<Pick<MusicProvider, 'getAlbumById' | 'getArtistById' | 'getSongById' | 'getArtistAlbums'>>;

/**
 * Static stations use the same normalized catalog contract as dynamic radio
 * providers without issuing a discovery request for channels that never change.
 */
export function createStaticRadioProvider(config: StaticRadioProviderConfig): StaticRadioProvider {
  const stationId = (value: string, prefix: string): string | null => {
    const id = value.startsWith(prefix) ? value.slice(prefix.length) : '';
    return config.stations.some((station) => station.id === id) ? id : null;
  };

  const stationById = (id: string): StaticRadioStation | null =>
    config.stations.find((station) => station.id === id) ?? null;

  const songFor = (station: StaticRadioStation, index = 0): Song => {
    const sourceUrl = station.sourceUrl ?? config.origin;
    return {
      id: `${config.idPrefix}-${station.id}`,
      title: station.title,
      artist: station.artist ?? config.artist,
      artistId: `${config.idPrefix}-artist-${station.id}`,
      album: station.description,
      albumId: `${config.idPrefix}-album-${station.id}`,
      coverArt: createDeterministicCover(`${config.coverKey}:${station.id}`, 220),
      duration: 0,
      track: index + 1,
      year: 0,
      genre: station.genre,
      path: station.streamUrl,
      bitRate: station.bitRate,
      contentType: station.contentType ?? 'audio/mpeg',
      suffix: station.suffix ?? 'mp3',
      size: 0,
      provider: config.name,
      sourceUrl,
      creatorUrl: config.origin,
      licenseName: 'Official live station',
      licenseUrl: config.origin,
      attributionUrl: sourceUrl,
      metadataVerified: true,
      isLive: true,
    };
  };

  const songToAlbum = (song: Song): Album => ({
    id: song.albumId,
    name: song.title,
    artist: song.artist,
    artistId: song.artistId,
    coverArt: song.coverArt,
    songCount: 1,
    duration: 0,
    year: 0,
    genre: song.genre,
  });

  const songToArtist = (song: Song): Artist => ({
    id: song.artistId,
    name: song.artist,
    coverArt: song.coverArt,
    albumCount: 1,
  });

  return {
    async search(query: string): Promise<Song[]> {
      const needle = query.trim().toLocaleLowerCase();
      if (!needle) return [];
      return config.stations
        .filter((station) =>
          `${station.title} ${station.artist ?? config.artist} ${station.description} ${station.genre}`
            .toLocaleLowerCase()
            .includes(needle),
        )
        .map(songFor);
    },

    async getSongsByTag(tag: string, limit = 20): Promise<Song[]> {
      return (await this.search(tag)).slice(0, limit);
    },

    async getTrending(limit = 20): Promise<Song[]> {
      return config.stations.slice(0, Math.max(0, limit)).map(songFor);
    },

    async getAlbums(signal?: AbortSignal): Promise<Album[]> {
      return (await this.getTrending(config.stations.length, signal)).map(songToAlbum);
    },

    async getArtists(signal?: AbortSignal): Promise<Artist[]> {
      return (await this.getTrending(config.stations.length, signal)).map(songToArtist);
    },

    async getAlbumById(albumId: string, signal?: AbortSignal): Promise<Album | null> {
      const id = stationId(albumId, `${config.idPrefix}-album-`);
      const song = id ? await this.getSongById(`${config.idPrefix}-${id}`, signal) : null;
      return song ? songToAlbum(song) : null;
    },

    async getArtistById(artistId: string, signal?: AbortSignal): Promise<Artist | null> {
      const id = stationId(artistId, `${config.idPrefix}-artist-`);
      const song = id ? await this.getSongById(`${config.idPrefix}-${id}`, signal) : null;
      return song ? songToArtist(song) : null;
    },

    async getAlbumSongs(albumId: string, signal?: AbortSignal): Promise<Song[]> {
      const id = stationId(albumId, `${config.idPrefix}-album-`);
      const song = id ? await this.getSongById(`${config.idPrefix}-${id}`, signal) : null;
      return song ? [song] : [];
    },

    async getArtistSongs(artistId: string, signal?: AbortSignal): Promise<Song[]> {
      const id = stationId(artistId, `${config.idPrefix}-artist-`);
      const song = id ? await this.getSongById(`${config.idPrefix}-${id}`, signal) : null;
      return song ? [song] : [];
    },

    async getArtistAlbums(artistId: string, signal?: AbortSignal): Promise<Album[]> {
      const song = (await this.getArtistSongs(artistId, signal))[0];
      return song ? [songToAlbum(song)] : [];
    },

    async getSongById(songId: string): Promise<Song | null> {
      const id = stationId(songId, `${config.idPrefix}-`);
      const station = id ? stationById(id) : null;
      return station ? songFor(station) : null;
    },

    async getStreamUrl(song: Song): Promise<string> {
      return song.path;
    },
  };
}
