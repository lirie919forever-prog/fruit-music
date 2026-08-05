import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kuwoProvider } from './kuwoProvider';
import type { Song } from '@/types/music';

function song(id = 'kuwo-1'): Song {
  return {
    id,
    title: 'Track',
    artist: 'Artist',
    artistId: 'kuwo-artist-1',
    album: 'Album',
    albumId: 'kuwo-album-1',
    coverArt: '/placeholder-album.svg',
    duration: 180,
    track: 0,
    year: 0,
    genre: '',
    path: '/api/music/kuwo/url?rid=1&br=320kmp3',
    bitRate: 320,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: 0,
    provider: 'Kuwo',
    sourceUrl: '',
    creatorUrl: '',
    licenseName: 'Source terms',
    licenseUrl: '',
    attributionUrl: '',
    metadataVerified: false,
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Kuwo provider', () => {
  it('decodes HTML entities across track metadata', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        abslist: [
          {
            DC_TARGETID: '1',
            NAME: 'Track&nbsp;Name',
            ARTIST: 'Taylor&nbsp;Swift',
            ALBUM: 'Best &amp; Brightest',
            DURATION: '211',
          },
        ],
      }),
    );

    const [result] = await kuwoProvider.search('Taylor Swift');

    expect(result).toMatchObject({
      title: 'Track Name',
      artist: 'Taylor Swift',
      album: 'Best & Brightest',
      duration: 211,
    });
  });

  it('decodes escaped unicode separators across track metadata', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        abslist: [
          {
            DC_TARGETID: '1',
            NAME: 'Track',
            ARTIST: 'Miles Davis\\u0026John Coltrane',
            ALBUM: 'Album',
            DURATION: '211',
          },
        ],
      }),
    );

    const [result] = await kuwoProvider.search('Miles Davis');

    expect(result.artist).toBe('Miles Davis&John Coltrane');
  });

  it('normalizes escaped separators returned by the live search endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        abslist: [
          {
            DC_TARGETID: '1',
            NAME: 'Track',
            ARTIST: 'Aditya Singh\\&Beats',
            ALBUM: 'Album',
            DURATION: '211',
          },
        ],
      }),
    );

    const [result] = await kuwoProvider.search('Aditya Singh');

    expect(result.artist).toBe('Aditya Singh&Beats');
  });

  it('repairs UTF-8 metadata decoded as Latin-1 by the upstream endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        abslist: [
          {
            DC_TARGETID: '1',
            NAME: '\u00e6\u00b5\u00b7\u00e3\u0081\u00ae\u00e3\u0081\u00be\u00e3\u0081\xab\u00e3\u0081\u00be\u00e3\u0081\xab',
            ARTIST: 'YOASOBI',
            ALBUM: '\u00e5\u00a4\u00a7\u00e5\u00a4\u00a9',
            DURATION: '292',
          },
        ],
      }),
    );

    const [result] = await kuwoProvider.search('YOASOBI');

    expect(result).toMatchObject({
      title: '\u6d77\u306e\u307e\u306b\u307e\u306b',
      album: '\u5927\u5929',
    });
  });

  it('requires a successful media probe before returning a stream URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ available: true }));

    await expect(kuwoProvider.getStreamUrl(song())).resolves.toBe(song().path);
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(new URL(String(url)).searchParams.get('probe')).toBe('1');
    expect(new URL(String(url)).searchParams.get('expected')).toBe('180');
  });

  it('does not accept a short resolver response as a playable stream', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ available: false, code: 'short' }));

    await expect(kuwoProvider.getStreamUrl(song())).rejects.toThrow('Kuwo stream is unavailable');
  });
});
