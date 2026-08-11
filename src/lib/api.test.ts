import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artist, Song } from '@/types/music';
import {
  archiveProvider,
  audiusProvider,
  bilibiliProvider,
  invidiousProvider,
  neteaseProvider,
  ccmixterProvider,
  deezerProvider,
  fipProvider,
  getMusicProviderForAlbumId,
  getMusicProviderForArtistId,
  getMusicProviderForName,
  getMusicProviderForSongId,
  itunesProvider,
  jamendoProvider,
  kexpProvider,
  kuwoProvider,
  lxmusicProvider,
  localProvider,
  ntsProvider,
  openverseProvider,
  qqMusicProvider,
  kugouProvider,
  radioBrowserProvider,
  radioFranceProvider,
  radioParadiseProvider,
  somaFmProvider,
  theCurrentProvider,
  wikimediaProvider,
} from '@/lib/providers';
import { api, searchFederated } from './api';
import { clearPlaybackResolutionCache } from './playbackResolutionCache';

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
  clearPlaybackResolutionCache();
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
  vi.spyOn(kuwoProvider, 'getStreamUrl').mockImplementation(async (track) => track.path);
  vi.spyOn(qqMusicProvider, 'search').mockResolvedValue([]);
  vi.spyOn(qqMusicProvider, 'getTrending').mockResolvedValue([]);
  vi.spyOn(qqMusicProvider, 'getSongsByTag').mockResolvedValue([]);
  vi.spyOn(qqMusicProvider, 'getStreamUrl').mockImplementation(async (track) => track.path);
  vi.spyOn(bilibiliProvider, 'search').mockResolvedValue([]);
  vi.spyOn(invidiousProvider, 'search').mockResolvedValue([]);
  vi.spyOn(neteaseProvider, 'search').mockResolvedValue([]);
  vi.spyOn(kugouProvider, 'search').mockResolvedValue([]);
  vi.spyOn(kugouProvider, 'getSongsByTag').mockResolvedValue([]);
  vi.spyOn(kugouProvider, 'getTrending').mockResolvedValue([]);
  vi.spyOn(kugouProvider, 'getStreamUrl').mockImplementation(async (track) => track.path);
  vi.spyOn(lxmusicProvider, 'search').mockResolvedValue([]);
  vi.spyOn(lxmusicProvider, 'getStreamUrl').mockImplementation(async (track) => track.path);
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
  vi.spyOn(ntsProvider, 'search').mockResolvedValue([]);
  vi.spyOn(ntsProvider, 'getSongsByTag').mockResolvedValue([]);
  vi.spyOn(ntsProvider, 'getTrending').mockResolvedValue([]);
  vi.spyOn(ntsProvider, 'getAlbums').mockResolvedValue([]);
  vi.spyOn(ntsProvider, 'getArtists').mockResolvedValue([]);
  vi.spyOn(radioParadiseProvider, 'search').mockResolvedValue([]);
  vi.spyOn(radioParadiseProvider, 'getSongsByTag').mockResolvedValue([]);
  vi.spyOn(radioParadiseProvider, 'getTrending').mockResolvedValue([]);
  vi.spyOn(radioParadiseProvider, 'getAlbums').mockResolvedValue([]);
  vi.spyOn(radioParadiseProvider, 'getArtists').mockResolvedValue([]);
  vi.spyOn(kexpProvider, 'search').mockResolvedValue([]);
  vi.spyOn(kexpProvider, 'getSongsByTag').mockResolvedValue([]);
  vi.spyOn(kexpProvider, 'getTrending').mockResolvedValue([]);
  vi.spyOn(kexpProvider, 'getAlbums').mockResolvedValue([]);
  vi.spyOn(kexpProvider, 'getArtists').mockResolvedValue([]);
  vi.spyOn(fipProvider, 'search').mockResolvedValue([]);
  vi.spyOn(fipProvider, 'getSongsByTag').mockResolvedValue([]);
  vi.spyOn(fipProvider, 'getTrending').mockResolvedValue([]);
  vi.spyOn(fipProvider, 'getAlbums').mockResolvedValue([]);
  vi.spyOn(fipProvider, 'getArtists').mockResolvedValue([]);
  vi.spyOn(theCurrentProvider, 'search').mockResolvedValue([]);
  vi.spyOn(theCurrentProvider, 'getSongsByTag').mockResolvedValue([]);
  vi.spyOn(theCurrentProvider, 'getTrending').mockResolvedValue([]);
  vi.spyOn(theCurrentProvider, 'getAlbums').mockResolvedValue([]);
  vi.spyOn(theCurrentProvider, 'getArtists').mockResolvedValue([]);
  vi.spyOn(radioBrowserProvider, 'search').mockResolvedValue([]);
  vi.spyOn(radioBrowserProvider, 'getSongsByTag').mockResolvedValue([]);
  vi.spyOn(radioBrowserProvider, 'getTrending').mockResolvedValue([]);
  vi.spyOn(radioBrowserProvider, 'getCountryStations').mockResolvedValue([]);
  vi.spyOn(radioBrowserProvider, 'getAlbums').mockResolvedValue([]);
  vi.spyOn(radioBrowserProvider, 'getArtists').mockResolvedValue([]);
  vi.spyOn(radioFranceProvider, 'search').mockResolvedValue([]);
  vi.spyOn(radioFranceProvider, 'getSongsByTag').mockResolvedValue([]);
  vi.spyOn(radioFranceProvider, 'getTrending').mockResolvedValue([]);
  vi.spyOn(radioFranceProvider, 'getAlbums').mockResolvedValue([]);
  vi.spyOn(radioFranceProvider, 'getArtists').mockResolvedValue([]);
  vi.spyOn(jamendoProvider, 'search').mockResolvedValue([]);
  vi.spyOn(ccmixterProvider, 'search').mockResolvedValue([]);
  vi.spyOn(archiveProvider, 'search').mockResolvedValue([]);
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
  it('scopes track search to the requested provider', async () => {
    vi.mocked(jamendoProvider.search).mockResolvedValue([song('jamendo-scoped')]);

    await expect(searchFederated('ambient', undefined, 'Jamendo')).resolves.toEqual({
      results: [song('jamendo-scoped')],
      failedProviders: [],
      providerCount: 1,
    });

    expect(jamendoProvider.search).toHaveBeenCalledTimes(1);
    expect(audiusProvider.search).not.toHaveBeenCalled();
    expect(itunesProvider.search).not.toHaveBeenCalled();
  });

  it('includes configured LX in default search and allows explicit source search', async () => {
    vi.stubEnv('NEXT_PUBLIC_LX_ENABLED', 'true');
    const lxResult = {
      ...song('jamendo-lx-result'),
      id: 'lxmusic-yoasobi-1',
      provider: 'LX Music' as const,
      title: '夜に駆ける',
      artist: 'YOASOBI',
      duration: 261,
    };
    vi.mocked(lxmusicProvider.search).mockResolvedValue([lxResult]);

    const defaultResults = await searchFederated('YOASOBI', undefined, 'all');
    expect(defaultResults.results).toEqual([lxResult]);
    expect(defaultResults.providerCount).toBe(23);
    expect(lxmusicProvider.search).toHaveBeenCalledTimes(1);

    await expect(searchFederated('YOASOBI', undefined, 'LX Music')).resolves.toEqual({
      results: [lxResult],
      failedProviders: [],
      providerCount: 1,
    });
    expect(lxmusicProvider.search).toHaveBeenCalledTimes(2);
  });

  it('keeps fallback results and reports a failed provider', async () => {
    vi.mocked(jamendoProvider.search).mockRejectedValue(new Error('unauthorized'));
    vi.mocked(ccmixterProvider.searchWithStatus).mockResolvedValue({ results: [song('ccmixter-1')] });
    vi.mocked(archiveProvider.search).mockResolvedValue([]);

    const state = await searchFederated('ambient');

    expect(state.results.map((result) => result.id)).toEqual(['ccmixter-1']);
    expect(state.failedProviders).toEqual(['Jamendo']);
    expect(state.providerCount).toBe(22);
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
      providerCount: 22,
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
      providerCount: 22,
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
      providerCount: 7,
    });
  });

  it('reports degraded trending providers without discarding healthy results', async () => {
    vi.spyOn(jamendoProvider, 'getTrending').mockResolvedValue([song('jamendo-1')]);
    vi.spyOn(ccmixterProvider, 'getTrendingWithStatus').mockResolvedValue({ results: [], degraded: true });

    await expect(api.getTrending()).resolves.toEqual({
      results: [song('jamendo-1')],
      failedProviders: [],
      degradedProviders: ['ccMixter'],
      providerCount: 7,
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
      'deezer-1',
      'audius-2',
      'jamendo-2',
    ]);
    expect(state.providerCount).toBe(7);
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
    vi.mocked(ntsProvider.getTrending).mockResolvedValue([
      { ...song('nts-1'), provider: 'NTS Radio', isLive: true },
      { ...song('nts-2'), provider: 'NTS Radio', isLive: true },
    ]);
    vi.mocked(radioParadiseProvider.getTrending).mockResolvedValue([
      { ...song('radioparadise-1'), provider: 'Radio Paradise', isLive: true },
      { ...song('radioparadise-2'), provider: 'Radio Paradise', isLive: true },
    ]);
    vi.mocked(kexpProvider.getTrending).mockResolvedValue([
      { ...song('kexp-1'), provider: 'KEXP', isLive: true },
      { ...song('kexp-2'), provider: 'KEXP', isLive: true },
    ]);
    vi.mocked(fipProvider.getTrending).mockResolvedValue([
      { ...song('fip-1'), provider: 'FIP', isLive: true },
      { ...song('fip-2'), provider: 'FIP', isLive: true },
    ]);
    vi.mocked(theCurrentProvider.getTrending).mockResolvedValue([
      { ...song('thecurrent-1'), provider: 'The Current', isLive: true },
      { ...song('thecurrent-2'), provider: 'The Current', isLive: true },
    ]);
    vi.mocked(radioFranceProvider.getTrending).mockResolvedValue([
      { ...song('radiofrance-1'), provider: 'Radio France', isLive: true },
      { ...song('radiofrance-2'), provider: 'Radio France', isLive: true },
    ]);

    const state = await api.getLiveStations(8);

    expect(state.results.map(({ id }) => id)).toEqual([
      'somafm-1',
      'nts-1',
      'radioparadise-1',
      'kexp-1',
      'fip-1',
      'thecurrent-1',
      'radiofrance-1',
      'radio-1',
    ]);
    expect(state.providerCount).toBe(9);
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

  it('passes the composed signal so a provider timeout aborts the underlying request', async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    vi.mocked(jamendoProvider.search).mockImplementation(async (_query, signal) => {
      receivedSignal = signal;
      // Never resolves on its own; the per-provider deadline is what ends it.
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      return [];
    });
    vi.mocked(archiveProvider.search).mockResolvedValue([]);
    vi.mocked(ccmixterProvider.searchWithStatus).mockResolvedValue({ results: [song('ccmixter-1')] });

    const pending = searchFederated('slow');
    // Advance past the 5s catalog provider deadline so the race settles.
    await vi.advanceTimersByTimeAsync(5_100);

    const state = await pending;
    expect(receivedSignal?.aborted).toBe(true);
    expect(state.failedProviders).toEqual(['Jamendo']);
    expect(state.results.map((result) => result.id)).toEqual(['ccmixter-1']);

    vi.useRealTimers();
  });

  it('deduplicates federated results by stable ID', async () => {
    vi.mocked(jamendoProvider.search).mockResolvedValue([song('jamendo-1')]);
    vi.mocked(ccmixterProvider.searchWithStatus).mockResolvedValue({ results: [song('jamendo-1')] });
    vi.mocked(archiveProvider.search).mockResolvedValue([]);

    const state = await searchFederated('duplicate');

    expect(state.results).toHaveLength(1);
    expect(state.results[0].id).toBe('jamendo-1');
  });

  it('keeps full-track genre sources balanced without preview providers', async () => {
    vi.mocked(jamendoProvider.getSongsByTag).mockResolvedValue([song('jamendo-1')]);
    vi.mocked(ccmixterProvider.getSongsByTagWithStatus).mockResolvedValue({ results: [song('ccmixter-1')] });

    const state = await api.getGenreSongs('pop', 4);

    expect(state.results.map((result) => result.id)).toEqual(['jamendo-1', 'ccmixter-1']);
    expect(state.failedProviders).toEqual([]);
    expect(state.providerCount).toBe(5);
  });

  it('does not add the optional LX adapter to default genre shelves', async () => {
    vi.stubEnv('NEXT_PUBLIC_LX_ENABLED', 'true');
    const lxGenreSearch = vi
      .spyOn(lxmusicProvider, 'getSongsByTag')
      .mockResolvedValue([{ ...song('jamendo-lx-genre'), id: 'lxmusic-genre-result', provider: 'LX Music' as const }]);

    const state = await api.getGenreSongs('pop', 4);

    expect(state.results.some((result) => result.provider === 'LX Music')).toBe(false);
    expect(state.providerCount).toBe(5);
    expect(lxGenreSearch).not.toHaveBeenCalled();
  });
});

describe('album federation', () => {
  it('scopes album and artist search to the requested provider', async () => {
    const scopedAlbum = {
      id: 'itunes-album-scoped',
      name: 'Scoped album',
      artist: 'Artist',
      artistId: 'itunes-artist-scoped',
      coverArt: '/placeholder-album.svg',
      songCount: 1,
      duration: 60,
      year: 2026,
      genre: 'Pop',
    };
    const scopedArtist = artist('itunes-artist-scoped');
    vi.spyOn(itunesProvider, 'searchAlbums').mockResolvedValue([]);
    vi.spyOn(itunesProvider, 'searchArtists').mockResolvedValue([]);
    vi.spyOn(audiusProvider, 'searchAlbums').mockResolvedValue([]);
    vi.spyOn(audiusProvider, 'searchArtists').mockResolvedValue([]);
    vi.mocked(itunesProvider.searchAlbums).mockResolvedValue([scopedAlbum]);
    vi.mocked(itunesProvider.searchArtists).mockResolvedValue([scopedArtist]);

    await expect(api.searchAlbums('artist', undefined, 'Apple Preview')).resolves.toEqual({
      results: [scopedAlbum],
      failedProviders: [],
      providerCount: 1,
    });
    await expect(api.searchArtists('artist', undefined, 'Apple Preview')).resolves.toEqual({
      results: [scopedArtist],
      failedProviders: [],
      providerCount: 1,
    });

    expect(itunesProvider.searchAlbums).toHaveBeenCalledTimes(1);
    expect(itunesProvider.searchArtists).toHaveBeenCalledTimes(1);
    expect(audiusProvider.searchAlbums).not.toHaveBeenCalled();
    expect(audiusProvider.searchArtists).not.toHaveBeenCalled();
  });

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

  it('removes pseudo albums from browse results while retaining real releases', async () => {
    const pseudoWikimediaAlbum = {
      id: 'wikimedia-album-42',
      name: 'Wikimedia Commons',
      artist: 'Contributor',
      artistId: 'wikimedia-artist-contributor',
      coverArt: '/placeholder-album.svg',
      songCount: 1,
      duration: 180,
      year: 2026,
      genre: 'Music',
    };
    const genericJamendoAlbum = {
      id: 'jamendo-unknown',
      name: 'Unknown',
      artist: 'Artist',
      artistId: 'jamendo-artist-1',
      coverArt: '/placeholder-album.svg',
      songCount: 1,
      duration: 180,
      year: 2026,
      genre: 'Pop',
    };
    const realAlbum = {
      ...genericJamendoAlbum,
      id: 'jamendo-real-release',
      name: 'Real release',
    };
    vi.mocked(wikimediaProvider.getAlbums).mockResolvedValue([pseudoWikimediaAlbum]);
    vi.mocked(jamendoProvider.getAlbums).mockResolvedValue([genericJamendoAlbum, realAlbum]);

    await expect(api.getAlbums()).resolves.toMatchObject({
      results: [realAlbum],
      failedProviders: [],
      providerCount: 6,
    });
  });

  it('removes pseudo albums from album search without marking the provider unavailable', async () => {
    const pseudoAlbum = {
      id: 'wikimedia-album-84',
      name: 'Wikimedia Commons',
      artist: 'Contributor',
      artistId: 'wikimedia-artist-contributor',
      coverArt: '/placeholder-album.svg',
      songCount: 1,
      duration: 180,
      year: 2026,
      genre: 'Music',
    };
    vi.spyOn(wikimediaProvider, 'searchAlbums').mockResolvedValue([pseudoAlbum]);

    await expect(api.searchAlbums('music', undefined, 'Wikimedia Commons')).resolves.toEqual({
      results: [],
      failedProviders: [],
      providerCount: 1,
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

  it('keeps direct lookup available for an album hidden from browse', async () => {
    const pseudoAlbum = {
      id: 'wikimedia-album-42',
      name: 'Wikimedia Commons',
      artist: 'Contributor',
      artistId: 'wikimedia-artist-contributor',
      coverArt: '/placeholder-album.svg',
      songCount: 1,
      duration: 180,
      year: 2026,
      genre: 'Music',
    };
    vi.spyOn(wikimediaProvider, 'getAlbumById').mockResolvedValue(pseudoAlbum);

    await expect(api.resolveAlbum('wikimedia-album-42')).resolves.toEqual(pseudoAlbum);
    expect(wikimediaProvider.getAlbums).not.toHaveBeenCalled();
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

  it('resolves an Apple preview to a matching Kuwo full-track source', async () => {
    const preview = {
      ...song('itunes-1440872304'),
      title: '夜に駆ける',
      artist: 'YOASOBI',
      duration: 30,
      provider: 'Apple Preview' as const,
    };
    const fullTrack = {
      ...song('kuwo-123456'),
      title: '夜に駆ける',
      artist: 'YOASOBI',
      duration: 261,
      provider: 'Kuwo' as const,
    };
    vi.mocked(kuwoProvider.search).mockResolvedValue([fullTrack]);

    await expect(api.getPlaybackSource(preview)).resolves.toEqual({
      song: fullTrack,
      streamUrl: '/api/music/kuwo/url?rid=123456',
    });
  });

  it('keeps the selected catalog artwork when a verified resolver match has only a placeholder cover', async () => {
    const preview = {
      ...song('itunes-artwork-preview'),
      title: 'Artwork match',
      artist: 'Artist',
      duration: 30,
      provider: 'Apple Preview' as const,
      coverArt: 'https://is1-ssl.mzstatic.com/image/thumb/Music/artwork.jpg',
    };
    const fullTrack = {
      ...song('kuwo-artwork-match'),
      title: preview.title,
      artist: preview.artist,
      duration: 222,
      provider: 'Kuwo' as const,
      coverArt: '/placeholder-album.svg',
    };
    vi.mocked(kuwoProvider.search).mockResolvedValue([fullTrack]);

    const resolved = await api.getPlaybackSource(preview);

    expect(resolved.song).toMatchObject({
      id: fullTrack.id,
      provider: 'Kuwo',
      coverArt: preview.coverArt,
    });
  });

  it('probes fallback candidates concurrently while preserving source priority', async () => {
    const preview = {
      ...song('itunes-concurrent-preview'),
      title: 'Concurrent match',
      artist: 'Artist',
      duration: 30,
      provider: 'Apple Preview' as const,
    };
    const candidates = ['first', 'second', 'third'].map((label) => ({
      ...song(`kuwo-${label}`),
      title: 'Concurrent match',
      artist: 'Artist',
      duration: 241,
      provider: 'Kuwo' as const,
    }));
    vi.mocked(kuwoProvider.search).mockResolvedValue(candidates);

    let activeProbes = 0;
    let maxActiveProbes = 0;
    vi.mocked(kuwoProvider.getStreamUrl).mockImplementation(async (candidate) => {
      activeProbes += 1;
      maxActiveProbes = Math.max(maxActiveProbes, activeProbes);
      try {
        await new Promise((resolve) => setTimeout(resolve, candidate.id.endsWith('-first') ? 20 : 2));
        if (candidate.id.endsWith('-first')) throw new Error('first candidate unavailable');
        return candidate.path;
      } finally {
        activeProbes -= 1;
      }
    });

    const result = await api.getPlaybackSource(preview);

    expect(result.song.id).toBe('kuwo-second');
    expect(result.streamUrl).toBe(candidates[1].path);
    expect(result.candidates?.map((candidate) => candidate.song.id)).toEqual(['kuwo-second', 'kuwo-third']);
    expect(maxActiveProbes).toBe(3);
  });

  it('tries a title fallback query when a provider ranks the combined query poorly', async () => {
    const preview = {
      ...song('itunes-query-ladder-preview'),
      title: 'Query ladder title',
      artist: 'Query ladder artist',
      duration: 30,
      provider: 'Apple Preview' as const,
    };
    const fullTrack = {
      ...song('kuwo-query-ladder'),
      title: preview.title,
      artist: preview.artist,
      duration: 212,
      provider: 'Kuwo' as const,
    };
    vi.mocked(kuwoProvider.search).mockImplementation(async (query) => (query === preview.title ? [fullTrack] : []));

    await expect(api.getPlaybackSource(preview)).resolves.toMatchObject({
      song: fullTrack,
      streamUrl: fullTrack.path,
    });
    expect(vi.mocked(kuwoProvider.search).mock.calls.map(([query]) => query)).toContain(preview.title);
  });

  it('accepts a complete normalized title-token match', async () => {
    const preview = {
      ...song('itunes-token-match-preview'),
      title: 'Blue Horizon',
      artist: 'Artist',
      duration: 30,
      provider: 'Apple Preview' as const,
    };
    const fullTrack = {
      ...song('kuwo-token-match'),
      title: 'Horizon Blue',
      artist: 'Artist',
      duration: 212,
      provider: 'Kuwo' as const,
    };
    vi.mocked(kuwoProvider.search).mockResolvedValue([fullTrack]);

    await expect(api.getPlaybackSource(preview)).resolves.toMatchObject({
      song: fullTrack,
      streamUrl: fullTrack.path,
    });
  });

  it('does not promote or play an arrangement whose artist only appears in the title', async () => {
    const preview = {
      ...song('itunes-arrangement-preview'),
      title: '青と夏',
      artist: 'Mrs. GREEN APPLE',
      duration: 30,
      recordingDuration: 271,
      provider: 'Apple Preview' as const,
    };
    const arrangement = {
      ...song('kuwo-arrangement'),
      title: '青と夏 (Mrs. GREEN APPLE)',
      artist: 'コロムビアオルゴール',
      duration: 288,
      provider: 'Kuwo' as const,
    };
    vi.mocked(kuwoProvider.search).mockResolvedValue([arrangement]);

    await expect(api.getPlaybackSource(preview)).rejects.toThrow('No verified full-length recording');
    expect(kuwoProvider.getStreamUrl).not.toHaveBeenCalled();
  });

  it('does not promote or play a different-length resolver record over a known recording', async () => {
    const preview = {
      ...song('itunes-duration-guard-preview'),
      title: 'Duration guarded title',
      artist: 'Artist',
      duration: 30,
      recordingDuration: 190,
      provider: 'Apple Preview' as const,
    };
    const wrongRecording = {
      ...song('kuwo-wrong-duration'),
      title: preview.title,
      artist: preview.artist,
      duration: 2660,
      provider: 'Kuwo' as const,
    };
    vi.mocked(kuwoProvider.search).mockResolvedValue([wrongRecording]);

    await expect(api.getPlaybackSource(preview)).rejects.toThrow('No verified full-length recording');
    expect(kuwoProvider.getStreamUrl).not.toHaveBeenCalled();
  });

  it('does not promote or play an unknown-duration resolver record over the official preview', async () => {
    const preview = {
      ...song('itunes-unknown-resolver-duration'),
      title: 'Unknown resolver duration',
      artist: 'Artist',
      duration: 30,
      provider: 'Apple Preview' as const,
    };
    const unknownDuration = {
      ...song('lxmusic-unknown-duration'),
      title: preview.title,
      artist: preview.artist,
      duration: 0,
      provider: 'LX Music' as const,
    };
    vi.stubEnv('NEXT_PUBLIC_LX_ENABLED', 'true');
    vi.mocked(lxmusicProvider.search).mockResolvedValue([unknownDuration]);

    await expect(api.getPlaybackSource(preview)).rejects.toThrow('No verified full-length recording');
    expect(lxmusicProvider.getStreamUrl).not.toHaveBeenCalled();
    expect(lxmusicProvider.search).toHaveBeenCalled();
  });

  it('reuses a verified proxy decision instead of repeating resolver search and probe', async () => {
    const preview = {
      ...song('itunes-cached-resolution'),
      title: 'Cached resolution',
      artist: 'Artist',
      duration: 30,
      provider: 'Apple Preview' as const,
    };
    const fullTrack = {
      ...song('kuwo-cached-resolution'),
      title: preview.title,
      artist: preview.artist,
      duration: 212,
      provider: 'Kuwo' as const,
    };
    vi.mocked(kuwoProvider.search).mockResolvedValue([fullTrack]);

    await api.getPlaybackSource(preview);
    await api.getPlaybackSource(preview);

    expect(kuwoProvider.search).toHaveBeenCalledTimes(1);
    expect(kuwoProvider.getStreamUrl).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent preview resolution into one resolver search', async () => {
    const preview = {
      ...song('itunes-concurrent-resolution'),
      title: 'Concurrent resolution',
      artist: 'Artist',
      duration: 30,
      provider: 'Apple Preview' as const,
    };
    const fullTrack = {
      ...song('kuwo-concurrent-resolution'),
      title: preview.title,
      artist: preview.artist,
      duration: 212,
      provider: 'Kuwo' as const,
    };
    let resolveSearch: (tracks: Song[]) => void = () => undefined;
    vi.mocked(kuwoProvider.search).mockImplementation(
      () =>
        new Promise<Song[]>((resolve) => {
          resolveSearch = resolve;
        }),
    );

    const first = api.getPlaybackSource(preview);
    const second = api.getPlaybackSource(preview);

    await vi.waitFor(() => expect(kuwoProvider.search).toHaveBeenCalledTimes(1));
    resolveSearch([fullTrack]);

    const [firstSource, secondSource] = await Promise.all([first, second]);
    expect(firstSource).toMatchObject({ song: fullTrack, streamUrl: fullTrack.path });
    expect(secondSource).toMatchObject({ song: fullTrack, streamUrl: fullTrack.path });
    expect(kuwoProvider.search).toHaveBeenCalledTimes(1);
    expect(kuwoProvider.getStreamUrl).toHaveBeenCalledTimes(1);
  });

  it('returns a verified direct Kuwo source without waiting for alternate searches', async () => {
    const direct = {
      ...song('kuwo-987654'),
      title: 'Healthy direct source',
      artist: 'Artist',
      duration: 241,
      provider: 'Kuwo' as const,
    };
    vi.mocked(kuwoProvider.getStreamUrl).mockResolvedValue(direct.path);
    vi.mocked(kuwoProvider.search).mockRejectedValue(new Error('optional search unavailable'));

    await expect(api.getPlaybackSource(direct)).resolves.toEqual({ song: direct, streamUrl: direct.path });
    expect(kuwoProvider.search).not.toHaveBeenCalled();
  });

  it('recovers a direct Kuwo mobile-only result through an exact Audius match', async () => {
    const direct = {
      ...song('kuwo-987654'),
      title: 'Mobile-only track',
      artist: 'Artist',
      duration: 241,
      provider: 'Kuwo' as const,
    };
    const audius = {
      ...song('audius-555'),
      title: 'Mobile-only track',
      artist: 'Artist',
      duration: 241,
      provider: 'Audius' as const,
    };
    vi.mocked(kuwoProvider.search).mockResolvedValue([direct]);
    vi.mocked(kuwoProvider.getStreamUrl).mockRejectedValue(new Error('mobile only'));
    vi.mocked(audiusProvider.search).mockResolvedValue([audius]);
    vi.spyOn(audiusProvider, 'getStreamUrl').mockResolvedValue(audius.path);

    await expect(api.getPlaybackSource(direct)).resolves.toEqual({
      song: audius,
      streamUrl: audius.path,
    });
    expect(kuwoProvider.search).not.toHaveBeenCalled();
  });

  it('recovers a failed explicit LX result through an exact Kuwo match', async () => {
    const direct = {
      ...song('jamendo-lx-dead'),
      id: 'lxmusic-dead-result',
      title: 'LX fallback title',
      artist: 'Artist',
      duration: 241,
      provider: 'LX Music' as const,
    };
    const kuwo = {
      ...song('kuwo-lx-fallback'),
      title: direct.title,
      artist: direct.artist,
      duration: direct.duration,
      provider: 'Kuwo' as const,
    };
    vi.mocked(lxmusicProvider.getStreamUrl).mockRejectedValue(new Error('resolver unavailable'));
    vi.mocked(kuwoProvider.search).mockResolvedValue([kuwo]);

    await expect(api.getPlaybackSource(direct)).resolves.toEqual({
      song: kuwo,
      streamUrl: kuwo.path,
    });
    expect(lxmusicProvider.search).not.toHaveBeenCalled();
  });

  it('does not turn a failed resolver identity into an official preview', async () => {
    const direct = {
      ...song('jamendo-lx-preview-fallback'),
      id: 'lxmusic-preview-fallback',
      title: 'Preview fallback title',
      artist: 'Preview artist',
      duration: 241,
      provider: 'LX Music' as const,
    };
    const preview = {
      ...song('itunes-preview-fallback'),
      title: direct.title,
      artist: direct.artist,
      duration: 30,
      recordingDuration: direct.duration,
      provider: 'Apple Preview' as const,
    };
    vi.mocked(lxmusicProvider.getStreamUrl).mockRejectedValue(new Error('resolver unavailable'));
    vi.mocked(itunesProvider.search).mockResolvedValue([preview]);

    await expect(api.getPlaybackSource(direct)).rejects.toThrow('resolver unavailable');
    expect(itunesProvider.search).not.toHaveBeenCalled();
  });

  it('does not include official previews in resolver alternates', async () => {
    const direct = {
      ...song('jamendo-lx-late-preview'),
      id: 'lxmusic-late-preview',
      title: 'Late preview title',
      artist: 'Late preview artist',
      duration: 241,
      provider: 'LX Music' as const,
    };
    const preview = {
      ...song('itunes-late-preview'),
      title: direct.title,
      artist: direct.artist,
      duration: 30,
      recordingDuration: direct.duration,
      provider: 'Apple Preview' as const,
    };
    vi.mocked(itunesProvider.search).mockResolvedValue([preview]);

    await expect(api.getPlaybackAlternates(direct)).resolves.toEqual([]);
    expect(itunesProvider.search).not.toHaveBeenCalled();
  });

  it('skips unavailable full-track candidates without falling back to the official preview', async () => {
    const preview = {
      ...song('itunes-1440872304'),
      title: 'Unavailable match',
      artist: 'Artist',
      provider: 'Apple Preview' as const,
    };
    const fullTrack = {
      ...song('kuwo-123456'),
      title: 'Unavailable match',
      artist: 'Artist',
      duration: 261,
      provider: 'Kuwo' as const,
    };
    vi.mocked(kuwoProvider.search).mockResolvedValue([fullTrack]);
    vi.mocked(kuwoProvider.getStreamUrl).mockRejectedValue(new Error('mobile only'));

    await expect(api.getPlaybackSource(preview)).rejects.toThrow('No verified full-length recording');
  });

  it('rejects playback when no full-track match exists', async () => {
    const preview = {
      ...song('itunes-1440872304'),
      title: 'Unindexed release',
      artist: 'Unknown artist',
      provider: 'Apple Preview' as const,
    };

    await expect(api.getPlaybackSource(preview)).rejects.toThrow('No verified full-length recording');
  });

  it('hydrates chart rankings with verified full-track sources', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          results: [
            {
              id: 'itunes-101',
              title: 'Chart song',
              artist: 'Chart artist',
              artistId: 'itunes-artist-1',
              album: 'Chart album',
              albumId: 'itunes-album-1',
              coverArt: '/placeholder-album.svg',
              duration: 30,
              track: 1,
              year: 2026,
              genre: 'Pop',
              path: '/api/music/itunes/stream/101',
              bitRate: 0,
              contentType: 'audio/mp4',
              suffix: 'm4a',
              size: 0,
              provider: 'Apple Preview',
              sourceUrl: 'https://example.com/chart',
              creatorUrl: 'https://example.com/artist',
              licenseName: '30-second preview',
              licenseUrl: 'https://example.com/license',
              attributionUrl: 'https://example.com/chart',
              metadataVerified: true,
            },
          ],
        }),
      ),
    );
    const fullTrack = {
      ...song('kuwo-101'),
      title: 'Chart song',
      artist: 'Chart artist',
      duration: 244,
      provider: 'Kuwo' as const,
    };
    vi.mocked(kuwoProvider.search).mockResolvedValue([fullTrack]);

    await expect(api.getChartSongs('billboard')).resolves.toEqual([fullTrack]);
  });

  it('hydrates Japanese chart rankings through configured LX full tracks', async () => {
    vi.stubEnv('NEXT_PUBLIC_LX_ENABLED', 'true');
    const preview = {
      ...song('itunes-jp-chart-preview'),
      title: 'Night Running',
      artist: 'YOASOBI',
      duration: 30,
      recordingDuration: 261,
      provider: 'Apple Preview' as const,
    };
    const fullTrack = {
      ...song('lxmusic-wy_1-jp-chart'),
      title: preview.title,
      artist: preview.artist,
      duration: 261,
      provider: 'LX Music' as const,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ results: [preview] })),
    );
    vi.mocked(lxmusicProvider.search).mockResolvedValue([fullTrack]);

    await expect(api.getChartSongs('jp')).resolves.toEqual([fullTrack]);
    expect(lxmusicProvider.search).toHaveBeenCalled();
  });

  it('hydrates a later chart row instead of limiting resolution to the first few entries', async () => {
    const previews = Array.from({ length: 5 }, (_, index) => ({
      ...song(`itunes-later-chart-${index + 1}`),
      title: `Chart song ${index + 1}`,
      artist: 'Chart artist',
      duration: 30,
      recordingDuration: 240,
      provider: 'Apple Preview' as const,
    }));
    const fullTrack = {
      ...song('kuwo-later-chart-5'),
      title: 'Chart song 5',
      artist: 'Chart artist',
      duration: 240,
      provider: 'Kuwo' as const,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ results: previews })),
    );
    vi.mocked(kuwoProvider.search).mockImplementation(async (query) =>
      query.includes('Chart song 5') ? [fullTrack] : [],
    );

    await expect(api.getChartSongs('billboard')).resolves.toEqual([...previews.slice(0, 4), fullTrack]);
  });

  it('keeps the home chart shelf on official previews until playback is requested', async () => {
    const preview = {
      ...song('itunes-home-chart-preview'),
      title: 'Home chart song',
      artist: 'Chart artist',
      duration: 30,
      recordingDuration: 240,
      provider: 'Apple Preview' as const,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ results: [preview] })),
    );

    await expect(api.getChartSongs('billboard', undefined, { resolveFullTracks: false })).resolves.toEqual([preview]);
    expect(vi.mocked(kuwoProvider.search)).not.toHaveBeenCalled();
    expect(vi.mocked(qqMusicProvider.search)).not.toHaveBeenCalled();
    expect(vi.mocked(lxmusicProvider.search)).not.toHaveBeenCalled();
  });

  it('attempts full-track hydration for every ranked chart row', async () => {
    const previews = Array.from({ length: 13 }, (_, index) => ({
      ...song(`itunes-chart-visible-${index + 1}`),
      title: `Visible chart song ${index + 1}`,
      artist: 'Chart artist',
      duration: 30,
      recordingDuration: 240,
      provider: 'Apple Preview' as const,
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ results: previews })),
    );

    await expect(api.getChartSongs('billboard')).resolves.toEqual(previews);
    expect(
      vi.mocked(kuwoProvider.search).mock.calls.some(([query]) => query.includes('Visible chart song 13')),
    ).toBe(true);
  });

  it('keeps a chart preview when the resolver only names the target artist in its title', async () => {
    const preview = {
      ...song('itunes-chart-explicit-artist'),
      title: '青と夏',
      artist: 'Mrs. GREEN APPLE',
      duration: 30,
      recordingDuration: 271,
      provider: 'Apple Preview' as const,
    };
    const fullTrack = {
      ...song('kuwo-chart-explicit-artist'),
      title: 'Mrs. GREEN APPLE - 青と夏',
      artist: 'Uploader',
      duration: 279,
      provider: 'Kuwo' as const,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ results: [preview] })),
    );
    vi.mocked(kuwoProvider.search).mockResolvedValue([fullTrack]);

    await expect(api.getChartSongs('billboard')).resolves.toEqual([preview]);
  });

  it('keeps a chart preview when the explicit resolver match is an arrangement', async () => {
    const preview = {
      ...song('itunes-chart-arrangement'),
      title: '青と夏',
      artist: 'Mrs. GREEN APPLE',
      duration: 30,
      recordingDuration: 271,
      provider: 'Apple Preview' as const,
    };
    const arrangement = {
      ...song('kuwo-chart-arrangement'),
      title: '青と夏 (Mrs. GREEN APPLE)',
      artist: 'コロムビアオルゴール',
      duration: 288,
      provider: 'Kuwo' as const,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ results: [preview] })),
    );
    vi.mocked(kuwoProvider.search).mockResolvedValue([arrangement]);

    await expect(api.getChartSongs('jp')).resolves.toEqual([preview]);
  });

  it('preserves unresolved Apple chart entries while replacing only verified matches', async () => {
    const verifiedPreview = {
      ...song('itunes-chart-1'),
      title: 'Verified chart song',
      artist: 'Chart artist',
      duration: 30,
      recordingDuration: 244,
      provider: 'Apple Preview' as const,
    };
    const unresolvedPreview = {
      ...song('itunes-chart-2'),
      title: 'Still charting',
      artist: 'Another artist',
      duration: 30,
      recordingDuration: 201,
      provider: 'Apple Preview' as const,
    };
    const fullTrack = {
      ...song('kuwo-chart-1'),
      title: verifiedPreview.title,
      artist: verifiedPreview.artist,
      duration: 244,
      provider: 'Kuwo' as const,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ results: [verifiedPreview, unresolvedPreview] })),
    );
    vi.mocked(kuwoProvider.search).mockResolvedValue([fullTrack]);

    await expect(api.getChartSongs('billboard')).resolves.toEqual([fullTrack, unresolvedPreview]);
  });

  it('routes song, album, and artist IDs to their owner', async () => {
    expect(getMusicProviderForSongId('jamendo-1')).toBe(jamendoProvider);
    expect(getMusicProviderForSongId('ccmixter-1')).toBe(ccmixterProvider);
    expect(getMusicProviderForSongId('archive-item')).toBe(archiveProvider);
    expect(getMusicProviderForSongId('itunes-1440872304')).toBe(itunesProvider);
    expect(getMusicProviderForSongId('deezer-3881984711')).toBe(deezerProvider);
    expect(getMusicProviderForSongId('qq-003b34Vx21nbbp')).toBe(qqMusicProvider);
    expect(getMusicProviderForSongId('audius-Evw5wAJ')).toBe(audiusProvider);
    expect(getMusicProviderForSongId('openverse-9e755b4d-4f1f-42db-a841-b8b2ebb583be')).toBe(openverseProvider);
    expect(getMusicProviderForSongId('wikimedia-175624708')).toBe(wikimediaProvider);
    expect(getMusicProviderForSongId('somafm-7soul')).toBe(somaFmProvider);
    expect(getMusicProviderForSongId('kexp-903')).toBe(kexpProvider);
    expect(getMusicProviderForSongId('fip-main')).toBe(fipProvider);
    expect(getMusicProviderForSongId('thecurrent-main')).toBe(theCurrentProvider);
    expect(getMusicProviderForSongId('radio-4f9898ba-e8f0-46c8-a5f5-a4b21fa3a832')).toBe(radioBrowserProvider);
    expect(getMusicProviderForSongId('local-local-song')).toBe(localProvider);
    expect(getMusicProviderForName('Apple Preview')).toBe(itunesProvider);
    expect(getMusicProviderForName('Local file')).toBe(localProvider);
    expect(getMusicProviderForAlbumId('ccmixter-album-user')).toBe(ccmixterProvider);
    expect(getMusicProviderForAlbumId('archive-album-item')).toBe(archiveProvider);
    expect(getMusicProviderForAlbumId('itunes-album-1440871397')).toBe(itunesProvider);
    expect(getMusicProviderForAlbumId('deezer-album-932772571')).toBe(deezerProvider);
    expect(getMusicProviderForAlbumId('audius-album-79yV0vg')).toBe(audiusProvider);
    expect(getMusicProviderForAlbumId('openverse-album-9e755b4d-4f1f-42db-a841-b8b2ebb583be')).toBe(openverseProvider);
    expect(getMusicProviderForAlbumId('wikimedia-album-175624708')).toBe(wikimediaProvider);
    expect(getMusicProviderForAlbumId('somafm-album-7soul')).toBe(somaFmProvider);
    expect(getMusicProviderForAlbumId('kexp-album-903')).toBe(kexpProvider);
    expect(getMusicProviderForAlbumId('fip-album-main')).toBe(fipProvider);
    expect(getMusicProviderForAlbumId('thecurrent-album-main')).toBe(theCurrentProvider);
    expect(getMusicProviderForAlbumId('radio-album-4f9898ba-e8f0-46c8-a5f5-a4b21fa3a832')).toBe(radioBrowserProvider);
    expect(getMusicProviderForArtistId('ccmixter-artist-user')).toBe(ccmixterProvider);
    expect(getMusicProviderForArtistId('archive-artist-user')).toBe(archiveProvider);
    expect(getMusicProviderForArtistId('itunes-artist-479756766')).toBe(itunesProvider);
    expect(getMusicProviderForArtistId('deezer-artist-5313805')).toBe(deezerProvider);
    expect(getMusicProviderForArtistId('audius-artist-Wem1e')).toBe(audiusProvider);
    expect(getMusicProviderForArtistId('openverse-artist-Mazelo%20Nostra')).toBe(openverseProvider);
    expect(getMusicProviderForArtistId('wikimedia-artist-Izi%20Music%20Production')).toBe(wikimediaProvider);
    expect(getMusicProviderForArtistId('somafm-artist-7soul')).toBe(somaFmProvider);
    expect(getMusicProviderForArtistId('kexp-artist-903')).toBe(kexpProvider);
    expect(getMusicProviderForArtistId('fip-artist-main')).toBe(fipProvider);
    expect(getMusicProviderForArtistId('thecurrent-artist-main')).toBe(theCurrentProvider);
    expect(getMusicProviderForArtistId('radio-artist-US')).toBe(radioBrowserProvider);

    await expect(api.getStreamUrl(song('jamendo-7'))).resolves.toBe('/api/music/jamendo/stream/7');
    await expect(api.getStreamUrl(song('ccmixter-8'))).resolves.toBe('/api/music/ccmixter/stream/8');
    await expect(api.getStreamUrl(song('archive-item_9'))).resolves.toBe('/api/music/archive/stream/item_9');
    await expect(api.getStreamUrl(song('wikimedia-7'))).resolves.toBe('/api/music/wikimedia/stream/7');
    await expect(
      api.getStreamUrl({ ...song('local-local-song'), provider: 'Local file', path: 'blob:marea-local-song' }),
    ).resolves.toBe('blob:marea-local-song');
  });
});
