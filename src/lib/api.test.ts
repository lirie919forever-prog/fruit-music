import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artist, Song } from '@/types/music';
import {
  archiveProvider,
  audiusProvider,
  ccmixterProvider,
  deezerProvider,
  getMusicProviderForAlbumId,
  getMusicProviderForArtistId,
  getMusicProviderForSongId,
  itunesProvider,
  jamendoProvider,
  kuwoProvider,
  openverseProvider,
  radioBrowserProvider,
  somaFmProvider,
  wikimediaProvider,
} from '@/lib/providers';
import { api, searchFederated } from './api';

function song(id: string): Song {
  const provider = id.startsWith('itunes-')
    ? 'Apple Preview'
    : id.startsWith('ccmixter-')
      ? 'ccMixter'
      : id.startsWith('archive-')
        ? 'Archive'
        : id.startsWith('wikimedia-')
          ? 'Wikimedia Commons'
          : id.startsWith('kuwo-')
            ? 'Kuwo'
            : 'Jamendo';
  return {
    id,
    title: id,
    artist: 'Artist',
    artistId: `${id}-artist`,
    album: 'Album',
    albumId: `${id}-album`,
    coverArt: '/placeholder-album.svg',
    duration: 1,
    track: 1,
    year: 0,
    genre: '',
    path:
      provider === 'Apple Preview'
        ? `/api/music/itunes/stream/${id.replace('itunes-', '')}`
        : provider === 'ccMixter'
          ? `/api/music/ccmixter/stream/${id.replace('ccmixter-', '')}`
          : provider === 'Archive'
            ? `/api/music/archive/stream/${id.replace('archive-', '')}`
            : provider === 'Wikimedia Commons'
              ? `/api/music/wikimedia/stream/${id.replace('wikimedia-', '')}`
              : provider === 'Kuwo'
                ? `/api/music/kuwo/url?rid=${id.replace('kuwo-', '')}`
                : `/api/music/jamendo/stream/${id.replace('jamendo-', '')}`,
    bitRate: 0,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: 1,
    provider,
    sourceUrl: 'https://example.com/track',
    creatorUrl: 'https://example.com/artist',
    licenseName: 'CC BY',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attributionUrl: 'https://example.com/track',
    metadataVerified: true,
  };
}

function artist(id: string): Artist {
  return { id, name: id, coverArt: '/placeholder-album.svg', albumCount: 1 };
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_LX_ENABLED', 'false');
  // Apple joins every federated call, so each test stubs it to silence rather
  // than reach the network; the tests that care about it override these.
  vi.spyOn(itunesProvider, 'search').mockResolvedValue([]);
  vi.spyOn(itunesProvider, 'getAlbums').mockResolvedValue([]);
  vi.spyOn(itunesProvider, 'getArtists').mockResolvedValue([]);
  vi.spyOn(itunesProvider, 'getTrending').mockResolvedValue([]);
  vi.spyOn(itunesProvider, 'getSongsByTag').mockResolvedValue([]);
  vi.spyOn(deezerProvider, 'search').mockResolvedValue([]);
  vi.spyOn(deezerProvider, 'getAlbums').mockResolvedValue([]);
  vi.spyOn(deezerProvider, 'getArtists').mockResolvedValue([]);
  vi.spyOn(deezerProvider, 'getTrending').mockResolvedValue([]);
  vi.spyOn(deezerProvider, 'getSongsByTag').mockResolvedValue([]);
  vi.spyOn(kuwoProvider, 'search').mockResolvedValue([]);
  vi.spyOn(kuwoProvider, 'getTrending').mockResolvedValue([]);
  vi.spyOn(kuwoProvider, 'getSongsByTag').mockResolvedValue([]);
  vi.spyOn(audiusProvider, 'search').mockResolvedValue([]);
  vi.spyOn(audiusProvider, 'getAlbums').mockResolvedValue([]);
  vi.spyOn(audiusProvider, 'getArtists').mockResolvedValue([]);
  vi.spyOn(audiusProvider, 'getTrending').mockResolvedValue([]);
  vi.spyOn(audiusProvider, 'getSongsByTag').mockResolvedValue([]);
  vi.spyOn(openverseProvider, 'search').mockResolvedValue([]);
  vi.spyOn(openverseProvider, 'getSongsByTag').mockResolvedValue([]);
  vi.spyOn(openverseProvider, 'getTrending').mockResolvedValue([]);
  vi.spyOn(wikimediaProvider, 'search').mockResolvedValue([]);
  vi.spyOn(wikimediaProvider, 'getSongsByTag').mockResolvedValue([]);
  vi.spyOn(wikimediaProvider, 'getTrending').mockResolvedValue([]);
  vi.spyOn(wikimediaProvider, 'getAlbums').mockResolvedValue([]);
  vi.spyOn(wikimediaProvider, 'getArtists').mockResolvedValue([]);
  vi.spyOn(somaFmProvider, 'search').mockResolvedValue([]);
  vi.spyOn(somaFmProvider, 'getSongsByTag').mockResolvedValue([]);
  vi.spyOn(somaFmProvider, 'getTrending').mockResolvedValue([]);
  vi.spyOn(somaFmProvider, 'getAlbums').mockResolvedValue([]);
  vi.spyOn(somaFmProvider, 'getArtists').mockResolvedValue([]);
  vi.spyOn(radioBrowserProvider, 'search').mockResolvedValue([]);
  vi.spyOn(radioBrowserProvider, 'getSongsByTag').mockResolvedValue([]);
  vi.spyOn(radioBrowserProvider, 'getTrending').mockResolvedValue([]);
  vi.spyOn(radioBrowserProvider, 'getAlbums').mockResolvedValue([]);
  vi.spyOn(radioBrowserProvider, 'getArtists').mockResolvedValue([]);
  vi.spyOn(jamendoProvider, 'search');
  vi.spyOn(jamendoProvider, 'getSongsByTag').mockResolvedValue([]);
  vi.spyOn(ccmixterProvider, 'searchWithStatus');
  vi.spyOn(ccmixterProvider, 'getSongsByTagWithStatus').mockResolvedValue({ results: [] });
  vi.spyOn(archiveProvider, 'search');
  vi.spyOn(archiveProvider, 'getSongsByTag').mockResolvedValue([]);
  vi.spyOn(jamendoProvider, 'getAlbums');
  vi.spyOn(ccmixterProvider, 'getAlbumsWithStatus');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('provider federation', () => {
  it('keeps fallback results and reports a failed provider', async () => {
    vi.mocked(jamendoProvider.search).mockRejectedValue(new Error('unauthorized'));
    vi.mocked(ccmixterProvider.searchWithStatus).mockResolvedValue({ results: [song('ccmixter-1')] });
    vi.mocked(archiveProvider.search).mockResolvedValue([]);

    const state = await searchFederated('ambient');

    expect(state.results.map((result) => result.id)).toEqual(['ccmixter-1']);
    expect(state.failedProviders).toEqual(['Jamendo']);
    expect(state.providerCount).toBe(11);
  });

  it('distinguishes true empty results from total provider failure', async () => {
    vi.mocked(jamendoProvider.search).mockResolvedValue([]);
    vi.mocked(ccmixterProvider.searchWithStatus).mockResolvedValue({ results: [] });
    vi.mocked(archiveProvider.search).mockResolvedValue([]);

    await expect(searchFederated('missing')).resolves.toMatchObject({
      results: [],
      failedProviders: [],
    });

    vi.mocked(jamendoProvider.search).mockRejectedValue(new Error('down'));
    vi.mocked(ccmixterProvider.searchWithStatus).mockRejectedValue(new Error('down'));
    vi.mocked(archiveProvider.search).mockRejectedValue(new Error('down'));

    await expect(searchFederated('missing')).resolves.toMatchObject({
      results: [],
      failedProviders: ['Jamendo', 'ccMixter', 'Archive'],
      providerCount: 11,
    });
  });

  it('reports degraded search providers while retaining their verified results', async () => {
    vi.mocked(jamendoProvider.search).mockResolvedValue([]);
    vi.mocked(ccmixterProvider.searchWithStatus).mockResolvedValue({
      results: [song('ccmixter-1')],
      degraded: true,
    });
    vi.mocked(archiveProvider.search).mockResolvedValue([]);

    await expect(searchFederated('ambient')).resolves.toEqual({
      results: [song('ccmixter-1')],
      failedProviders: [],
      degradedProviders: ['ccMixter'],
      providerCount: 11,
    });
  });

  it('reports failed artist providers while retaining successful results', async () => {
    vi.spyOn(jamendoProvider, 'getArtists').mockRejectedValue(new Error('down'));
    vi.spyOn(ccmixterProvider, 'getArtistsWithStatus').mockResolvedValue({
      results: [artist('ccmixter-artist-user')],
    });

    await expect(api.getArtists()).resolves.toEqual({
      results: [artist('ccmixter-artist-user')],
      failedProviders: ['Jamendo'],
      providerCount: 6,
    });
  });

  it('reports degraded artist providers without discarding healthy results', async () => {
    vi.spyOn(jamendoProvider, 'getArtists').mockResolvedValue([artist('jamendo-artist-1')]);
    vi.spyOn(ccmixterProvider, 'getArtistsWithStatus').mockResolvedValue({ results: [], degraded: true });

    await expect(api.getArtists()).resolves.toEqual({
      results: [artist('jamendo-artist-1')],
      failedProviders: [],
      degradedProviders: ['ccMixter'],
      providerCount: 6,
    });
  });

  it('reports total trending failure instead of silently returning empty', async () => {
    vi.spyOn(jamendoProvider, 'getTrending').mockRejectedValue(new Error('down'));
    vi.spyOn(ccmixterProvider, 'getTrendingWithStatus').mockRejectedValue(new Error('down'));

    await expect(api.getTrending()).resolves.toMatchObject({
      results: [],
      failedProviders: ['Jamendo', 'ccMixter'],
      providerCount: 11,
    });
  });

  it('reports degraded trending providers without discarding healthy results', async () => {
    vi.spyOn(jamendoProvider, 'getTrending').mockResolvedValue([song('jamendo-1')]);
    vi.spyOn(ccmixterProvider, 'getTrendingWithStatus').mockResolvedValue({ results: [], degraded: true });

    await expect(api.getTrending()).resolves.toEqual({
      results: [song('jamendo-1')],
      failedProviders: [],
      degradedProviders: ['ccMixter'],
      providerCount: 11,
    });
  });

  it('interleaves trending providers within the requested result window', async () => {
    vi.mocked(itunesProvider.getTrending).mockResolvedValue([
      { ...song('itunes-1'), provider: 'Apple Preview' },
      { ...song('itunes-2'), provider: 'Apple Preview' },
    ]);
    vi.mocked(deezerProvider.getTrending).mockResolvedValue([
      { ...song('deezer-1'), provider: 'Deezer Preview' },
      { ...song('deezer-2'), provider: 'Deezer Preview' },
    ]);
    vi.mocked(audiusProvider.getTrending).mockResolvedValue([
      { ...song('audius-1'), provider: 'Audius' },
      { ...song('audius-2'), provider: 'Audius' },
    ]);
    vi.spyOn(jamendoProvider, 'getTrending').mockResolvedValue([song('jamendo-1'), song('jamendo-2')]);
    vi.spyOn(ccmixterProvider, 'getTrendingWithStatus').mockResolvedValue({
      results: [song('ccmixter-1'), song('ccmixter-2')],
    });

    const state = await api.getTrending(6);

    expect(state.results.map((result) => result.id)).toEqual([
      'audius-1',
      'jamendo-1',
      'ccmixter-1',
      'itunes-1',
      'deezer-1',
      'audius-2',
    ]);
    expect(state.providerCount).toBe(11);
  });

  it('keeps live stations source-balanced and independent from the larger trending mix', async () => {
    vi.mocked(somaFmProvider.getTrending).mockResolvedValue([
      { ...song('somafm-1'), provider: 'SomaFM', isLive: true },
      { ...song('somafm-2'), provider: 'SomaFM', isLive: true },
    ]);
    vi.mocked(radioBrowserProvider.getTrending).mockResolvedValue([
      { ...song('radio-1'), provider: 'Radio Browser', isLive: true },
      { ...song('radio-2'), provider: 'Radio Browser', isLive: true },
    ]);

    const state = await api.getLiveStations(4);

    expect(state.results.map(({ id }) => id)).toEqual(['somafm-1', 'radio-1', 'somafm-2', 'radio-2']);
    expect(state.providerCount).toBe(2);
  });

  it('preserves degradation for dedicated ccMixter categories', async () => {
    vi.spyOn(ccmixterProvider, 'getSongsByTagWithStatus').mockResolvedValue({
      results: [],
      degraded: true,
    });

    await expect(api.getCcmixterSongsByTag('jazz')).resolves.toEqual({
      results: [],
      failedProviders: [],
      degradedProviders: ['ccMixter'],
      providerCount: 1,
    });
  });

  it('rethrows an externally aborted search as AbortError', async () => {
    const controller = new AbortController();
    vi.mocked(jamendoProvider.search).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new DOMException('Aborted', 'AbortError');
    });
    vi.mocked(archiveProvider.search).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new DOMException('Aborted', 'AbortError');
    });
    vi.mocked(ccmixterProvider.searchWithStatus).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new DOMException('Aborted', 'AbortError');
    });

    const pending = searchFederated('ambient', controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('deduplicates federated results by stable ID', async () => {
    vi.mocked(jamendoProvider.search).mockResolvedValue([song('jamendo-1')]);
    vi.mocked(ccmixterProvider.searchWithStatus).mockResolvedValue({ results: [song('jamendo-1')] });
    vi.mocked(archiveProvider.search).mockResolvedValue([]);

    const state = await searchFederated('duplicate');

    expect(state.results).toHaveLength(1);
    expect(state.results[0].id).toBe('jamendo-1');
  });

  it('interleaves genre sources and keeps the shelf useful without Jamendo', async () => {
    vi.mocked(itunesProvider.getSongsByTag).mockResolvedValue([song('itunes-1'), song('itunes-2')]);
    vi.mocked(jamendoProvider.getSongsByTag).mockRejectedValue(new Error('Jamendo client id missing'));
    vi.mocked(ccmixterProvider.getSongsByTagWithStatus).mockResolvedValue({ results: [song('ccmixter-1')] });

    const state = await api.getGenreSongs('pop', 4);

    expect(state.results.map((result) => result.id)).toEqual(['itunes-1', 'ccmixter-1', 'itunes-2']);
    expect(state.failedProviders).toEqual(['Jamendo']);
    expect(state.providerCount).toBe(10);
  });
});

describe('album federation', () => {
  it('reports degraded albums while retaining available results', async () => {
    const availableAlbum = {
      id: 'jamendo-album-1',
      name: 'Available album',
      artist: 'Artist',
      artistId: 'jamendo-artist-1',
      coverArt: '/placeholder-album.svg',
      songCount: 1,
      duration: 60,
      year: 2024,
      genre: 'ambient',
    };
    vi.mocked(jamendoProvider.getAlbums).mockResolvedValue([availableAlbum]);
    vi.mocked(ccmixterProvider.getAlbumsWithStatus).mockResolvedValue({ results: [], degraded: true });

    await expect(api.getAlbums()).resolves.toEqual({
      results: [availableAlbum],
      failedProviders: [],
      degradedProviders: ['ccMixter'],
      providerCount: 6,
    });
  });

  it('reports all failed album providers instead of a silent empty state', async () => {
    vi.mocked(jamendoProvider.getAlbums).mockRejectedValue(new Error('down'));
    vi.mocked(ccmixterProvider.getAlbumsWithStatus).mockRejectedValue(new Error('down'));

    await expect(api.getAlbums()).resolves.toMatchObject({
      results: [],
      failedProviders: ['Jamendo', 'ccMixter'],
      providerCount: 6,
    });
  });

  it('resolves a deep-linked album outside the catalog page by direct lookup', async () => {
    const deepLinked = {
      id: 'jamendo-25',
      name: 'Mind Asylum',
      artist: 'Skaut',
      artistId: 'jamendo-artist-9',
      coverArt: '/placeholder-album.svg',
      songCount: 0,
      duration: 0,
      year: 2004,
      genre: '',
    };
    vi.spyOn(jamendoProvider, 'getAlbumById').mockResolvedValue(deepLinked);
    vi.mocked(jamendoProvider.getAlbums).mockResolvedValue([]);
    vi.mocked(ccmixterProvider.getAlbumsWithStatus).mockResolvedValue({ results: [] });

    await expect(api.resolveAlbum('jamendo-25')).resolves.toEqual(deepLinked);
    expect(jamendoProvider.getAlbums).not.toHaveBeenCalled();
  });

  it('falls back to the catalog listing when direct album lookup finds nothing', async () => {
    const listed = {
      id: 'ccmixter-album-user',
      name: "User's Tracks",
      artist: 'User',
      artistId: 'ccmixter-artist-user',
      coverArt: '/placeholder-album.svg',
      songCount: 2,
      duration: 120,
      year: 0,
      genre: '',
    };
    vi.spyOn(ccmixterProvider, 'getAlbumById').mockResolvedValue(null);
    vi.mocked(jamendoProvider.getAlbums).mockResolvedValue([]);
    vi.mocked(ccmixterProvider.getAlbumsWithStatus).mockResolvedValue({ results: [listed] });

    await expect(api.resolveAlbum('ccmixter-album-user')).resolves.toEqual(listed);
  });

  it('resolves a deep-linked artist outside the catalog page by direct lookup', async () => {
    const deepLinked = artist('jamendo-artist-602037');
    vi.spyOn(jamendoProvider, 'getArtistById').mockResolvedValue(deepLinked);
    vi.spyOn(jamendoProvider, 'getArtists').mockResolvedValue([]);
    vi.spyOn(ccmixterProvider, 'getArtistsWithStatus').mockResolvedValue({ results: [] });

    await expect(api.resolveArtist('jamendo-artist-602037')).resolves.toEqual(deepLinked);
    expect(jamendoProvider.getArtists).not.toHaveBeenCalled();
  });

  it('routes song, album, and artist IDs to their owner', async () => {
    expect(getMusicProviderForSongId('jamendo-1')).toBe(jamendoProvider);
    expect(getMusicProviderForSongId('ccmixter-1')).toBe(ccmixterProvider);
    expect(getMusicProviderForSongId('archive-item')).toBe(archiveProvider);
    expect(getMusicProviderForSongId('itunes-1440872304')).toBe(itunesProvider);
    expect(getMusicProviderForSongId('deezer-3881984711')).toBe(deezerProvider);
    expect(getMusicProviderForSongId('audius-Evw5wAJ')).toBe(audiusProvider);
    expect(getMusicProviderForSongId('openverse-9e755b4d-4f1f-42db-a841-b8b2ebb583be')).toBe(openverseProvider);
    expect(getMusicProviderForSongId('wikimedia-175624708')).toBe(wikimediaProvider);
    expect(getMusicProviderForSongId('somafm-7soul')).toBe(somaFmProvider);
    expect(getMusicProviderForSongId('radio-4f9898ba-e8f0-46c8-a5f5-a4b21fa3a832')).toBe(radioBrowserProvider);
    expect(getMusicProviderForAlbumId('ccmixter-album-user')).toBe(ccmixterProvider);
    expect(getMusicProviderForAlbumId('archive-album-item')).toBe(archiveProvider);
    expect(getMusicProviderForAlbumId('itunes-album-1440871397')).toBe(itunesProvider);
    expect(getMusicProviderForAlbumId('deezer-album-932772571')).toBe(deezerProvider);
    expect(getMusicProviderForAlbumId('audius-album-79yV0vg')).toBe(audiusProvider);
    expect(getMusicProviderForAlbumId('openverse-album-9e755b4d-4f1f-42db-a841-b8b2ebb583be')).toBe(openverseProvider);
    expect(getMusicProviderForAlbumId('wikimedia-album-175624708')).toBe(wikimediaProvider);
    expect(getMusicProviderForAlbumId('somafm-album-7soul')).toBe(somaFmProvider);
    expect(getMusicProviderForAlbumId('radio-album-4f9898ba-e8f0-46c8-a5f5-a4b21fa3a832')).toBe(radioBrowserProvider);
    expect(getMusicProviderForArtistId('ccmixter-artist-user')).toBe(ccmixterProvider);
    expect(getMusicProviderForArtistId('archive-artist-user')).toBe(archiveProvider);
    expect(getMusicProviderForArtistId('itunes-artist-479756766')).toBe(itunesProvider);
    expect(getMusicProviderForArtistId('deezer-artist-5313805')).toBe(deezerProvider);
    expect(getMusicProviderForArtistId('audius-artist-Wem1e')).toBe(audiusProvider);
    expect(getMusicProviderForArtistId('openverse-artist-Mazelo%20Nostra')).toBe(openverseProvider);
    expect(getMusicProviderForArtistId('wikimedia-artist-Izi%20Music%20Production')).toBe(wikimediaProvider);
    expect(getMusicProviderForArtistId('somafm-artist-7soul')).toBe(somaFmProvider);
    expect(getMusicProviderForArtistId('radio-artist-US')).toBe(radioBrowserProvider);

    await expect(api.getStreamUrl(song('jamendo-7'))).resolves.toBe('/api/music/jamendo/stream/7');
    await expect(api.getStreamUrl(song('ccmixter-8'))).resolves.toBe('/api/music/ccmixter/stream/8');
    await expect(api.getStreamUrl(song('archive-item_9'))).resolves.toBe('/api/music/archive/stream/item_9');
    await expect(api.getStreamUrl(song('wikimedia-7'))).resolves.toBe('/api/music/wikimedia/stream/7');
  });
});
