import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types/music';
import {
  archiveProvider,
  ccmixterProvider,
  getMusicProviderForAlbumId,
  getMusicProviderForArtistId,
  getMusicProviderForSongId,
  jamendoProvider,
} from '@/lib/providers';
import { api, searchFederated } from './api';

function song(id: string): Song {
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
    path: id.startsWith('ccmixter-')
      ? `/api/music/ccmixter/stream/${id.replace('ccmixter-', '')}`
      : id.startsWith('archive-')
        ? `/api/music/archive/stream/${id.replace('archive-', '')}`
        : `/api/music/jamendo/stream/${id.replace('jamendo-', '')}`,
    bitRate: 0,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: 1,
    provider: id.startsWith('ccmixter-') ? 'ccMixter' : id.startsWith('archive-') ? 'Archive' : 'Jamendo',
    sourceUrl: 'https://example.com/track',
    creatorUrl: 'https://example.com/artist',
    licenseName: 'CC BY',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attributionUrl: 'https://example.com/track',
    metadataVerified: true,
  };
}

beforeEach(() => {
  vi.spyOn(jamendoProvider, 'search');
  vi.spyOn(ccmixterProvider, 'search');
  vi.spyOn(archiveProvider, 'search');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('provider federation', () => {
  it('keeps fallback results and reports a failed provider', async () => {
    vi.mocked(jamendoProvider.search).mockRejectedValue(new Error('unauthorized'));
    vi.mocked(ccmixterProvider.search).mockResolvedValue([song('ccmixter-1')]);
    vi.mocked(archiveProvider.search).mockResolvedValue([song('archive-item')]);

    const state = await searchFederated('ambient');

    expect(state.results.map((result) => result.id)).toEqual(['ccmixter-1', 'archive-item']);
    expect(state.failedProviders).toEqual(['Jamendo']);
    expect(state.providerCount).toBe(3);
  });

  it('distinguishes true empty results from total provider failure', async () => {
    vi.mocked(jamendoProvider.search).mockResolvedValue([]);
    vi.mocked(ccmixterProvider.search).mockResolvedValue([]);
    vi.mocked(archiveProvider.search).mockResolvedValue([]);

    await expect(searchFederated('missing')).resolves.toMatchObject({
      results: [],
      failedProviders: [],
    });

    vi.mocked(jamendoProvider.search).mockRejectedValue(new Error('down'));
    vi.mocked(ccmixterProvider.search).mockRejectedValue(new Error('down'));
    vi.mocked(archiveProvider.search).mockRejectedValue(new Error('down'));

    await expect(searchFederated('missing')).resolves.toMatchObject({
      results: [],
      failedProviders: ['Jamendo', 'ccMixter', 'Archive'],
      providerCount: 3,
    });
  });

  it('deduplicates repeated provider-prefixed IDs', async () => {
    vi.mocked(jamendoProvider.search).mockResolvedValue([song('jamendo-1')]);
    vi.mocked(ccmixterProvider.search).mockResolvedValue([song('jamendo-1')]);
    vi.mocked(archiveProvider.search).mockResolvedValue([]);

    const state = await searchFederated('duplicate');

    expect(state.results).toHaveLength(1);
    expect(state.results[0].id).toBe('jamendo-1');
  });
});

describe('provider dispatch', () => {
  it('routes song, album, and artist IDs to their owner', async () => {
    expect(getMusicProviderForSongId('jamendo-1')).toBe(jamendoProvider);
    expect(getMusicProviderForSongId('ccmixter-1')).toBe(ccmixterProvider);
    expect(getMusicProviderForSongId('archive-item')).toBe(archiveProvider);
    expect(getMusicProviderForAlbumId('ccmixter-album-user')).toBe(ccmixterProvider);
    expect(getMusicProviderForAlbumId('archive-album-item')).toBe(archiveProvider);
    expect(getMusicProviderForArtistId('ccmixter-artist-user')).toBe(ccmixterProvider);
    expect(getMusicProviderForArtistId('archive-artist-user')).toBe(archiveProvider);

    await expect(api.getStreamUrl(song('jamendo-7'))).resolves.toBe('/api/music/jamendo/stream/7');
    await expect(api.getStreamUrl(song('ccmixter-8'))).resolves.toBe('/api/music/ccmixter/stream/8');
    await expect(api.getStreamUrl(song('archive-item_9'))).resolves.toBe('/api/music/archive/stream/item_9');
  });
});
