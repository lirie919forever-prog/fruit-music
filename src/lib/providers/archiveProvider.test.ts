import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveProvider } from './archiveProvider';

beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Archive provider', () => {
  it('preserves the concrete file identity in the song ID', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      results: [{
        identifier: 'concert-1',
        title: 'Movement I',
        creator: '東京楽団',
        subject: ['classical'],
        filename: 'Disc 1/01 Movement I.mp3',
        duration: 125,
        size: 1024,
        bitRate: 192,
        contentType: 'audio/mpeg',
        suffix: 'mp3',
        streamUrl: '/api/music/archive/stream/concert-1?file=Disc%201%2F01%20Movement%20I.mp3',
        sourceUrl: 'https://archive.org/details/concert-1',
        creatorUrl: '',
        licenseName: 'CC BY',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        attributionUrl: 'https://archive.org/details/concert-1',
      }],
    }));

    const songs = await archiveProvider.search('classical');

    expect(songs).toHaveLength(1);
    expect(songs[0].id).toContain('concert-1~Disc%201%2F01%20Movement%20I.mp3');
    expect(songs[0].path).toContain('file=Disc%201%2F01%20Movement%20I.mp3');
    expect(songs[0].coverArt).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
  });
});
