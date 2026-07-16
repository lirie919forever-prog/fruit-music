import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ccmixterProvider } from './ccmixterProvider';

beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ccMixter provider', () => {
  it('resolves artist-derived albums through user_name instead of a generic tag', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ results: [] }));

    await ccmixterProvider.getAlbumSongs('ccmixter-album-音楽家');

    const requestedUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(requestedUrl).toContain('user_name=%E9%9F%B3%E6%A5%BD%E5%AE%B6');
    expect(requestedUrl).not.toContain('tags=');
  });

  it('maps Unicode creators without relying on btoa', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      results: [{
        upload_id: 42,
        upload_name: 'Track',
        user_name: '音楽家',
        user_real_name: '音楽家',
        license_url: 'https://creativecommons.org/licenses/by/4.0/',
        file_page_url: 'https://ccmixter.org/files/example/42',
        files: [{
          download_url: 'https://ccmixter.org/content/example/track.mp3',
          file_rawsize: 100,
          file_format_info: { mime_type: 'audio/mpeg', ps: '1:02' },
        }],
      }],
    }));

    const songs = await ccmixterProvider.search('track');

    expect(songs).toHaveLength(1);
    expect(songs[0].coverArt).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(songs[0].duration).toBe(62);
  });
});
