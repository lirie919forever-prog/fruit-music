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

  it('accumulates album duration while deriving albums', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      results: [
        {
          id: '42',
          name: 'One',
          artist_name: 'Artist',
          artist_id: '7',
          album_name: 'Album',
          album_id: '9',
          duration: 62,
          audio: 'https://example.com/one.mp3',
          license_ccurl: 'https://creativecommons.org/licenses/by/4.0/',
          shareurl: 'https://www.jamendo.com/track/42',
        },
        {
          id: '43',
          name: 'Two',
          artist_name: 'Artist',
          artist_id: '7',
          album_name: 'Album',
          album_id: '9',
          duration: 38,
          audio: 'https://example.com/two.mp3',
          license_ccurl: 'https://creativecommons.org/licenses/by/4.0/',
          shareurl: 'https://www.jamendo.com/track/43',
        },
      ],
    }));

    await expect(jamendoProvider.getAlbums()).resolves.toMatchObject([
      { id: 'jamendo-9', songCount: 2, duration: 100 },
    ]);
  });

  it('drops unresolved records instead of inventing playable metadata', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ results: [{ id: '42' }] }));

    const results = await jamendoProvider.search('unknown');

    expect(results).toEqual([]);
  });
});
