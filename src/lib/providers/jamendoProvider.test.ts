import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jamendoProvider } from './jamendoProvider';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Jamendo provider', () => {
  it('maps valid tracks and drops malformed records', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      results: [
        {
          id: '42',
          name: 'Rock &amp; Roll',
          artist_name: 'Artist',
          artist_id: '7',
          album_name: 'Album',
          album_id: '9',
          image: 'https://example.com/cover.jpg',
          duration: 61.6,
          position: 2,
          audio: 'https://example.com/song.mp3',
          license_ccurl: 'https://creativecommons.org/licenses/by/4.0/',
          shareurl: 'https://www.jamendo.com/track/42',
        },
        { id: 'not-numeric', name: 'Invalid' },
        null,
      ],
    }));

    const results = await jamendoProvider.search('rock');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'jamendo-42',
      title: 'Rock & Roll',
      artistId: 'jamendo-artist-7',
      albumId: 'jamendo-9',
      duration: 62,
      track: 2,
      contentType: 'audio/mpeg',
    });
  });

  it('maps album summaries from the Jamendo albums endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      results: [{
        id: '9',
        name: 'Album',
        artist_id: '7',
        artist_name: 'Artist',
        image: 'https://example.com/album.jpg',
        releasedate: '2025-06-01',
      }],
    }));

    await expect(jamendoProvider.getAlbums()).resolves.toEqual([{
      id: 'jamendo-9',
      name: 'Album',
      artist: 'Artist',
      artistId: 'jamendo-artist-7',
      coverArt: 'https://example.com/album.jpg',
      songCount: 0,
      duration: 0,
      year: 2025,
      genre: '',
    }]);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('/api/music/jamendo/albums');
  });
  it('drops unresolved records instead of inventing playable metadata', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ results: [{ id: '42' }] }));

    const results = await jamendoProvider.search('unknown');

    expect(results).toEqual([]);
  });

  it('retries a listing once when Jamendo answers success with no results', async () => {
    // Throttled requests come back 200 with an empty `results` array, so the
    // emptiness has to be retried rather than believed.
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ headers: { status: 'success', code: 0 }, results: [] }))
      .mockResolvedValueOnce(Response.json({
        results: [{
          id: '9',
          name: 'Album',
          artist_id: '7',
          artist_name: 'Artist',
          image: 'https://example.com/album.jpg',
          releasedate: '2025-06-01',
        }],
      }));

    const albums = await jamendoProvider.getAlbums();

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(albums).toHaveLength(1);
    expect(albums[0].id).toBe('jamendo-9');
  });

  it('accepts a genuinely empty listing after one retry rather than looping', async () => {
    // A fresh Response per call: a body can only be read once, so a shared
    // instance would fail the retry on `Body already read` instead of emptiness.
    vi.mocked(fetch).mockImplementation(async () => Response.json({ results: [] }));

    await expect(jamendoProvider.getAlbumSongs('jamendo-9')).resolves.toEqual([]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('does not spend a retry on a search that legitimately matches nothing', async () => {
    vi.mocked(fetch).mockImplementation(async () => Response.json({ results: [] }));

    await expect(jamendoProvider.search('zzzznomatch')).resolves.toEqual([]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});
