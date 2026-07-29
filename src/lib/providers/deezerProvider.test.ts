import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deezerProvider, deezerTrackToSong, type DeezerTrack } from './deezerProvider';

beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function track(overrides: Partial<DeezerTrack> = {}): DeezerTrack {
  return {
    id: 3881984711,
    readable: true,
    title: 'Pop',
    duration: 216,
    preview: 'https://cdnt-preview.dzcdn.net/audio.mp3',
    link: 'https://www.deezer.com/track/3881984711',
    position: 2,
    artist: { id: 5313805, name: 'Harry Styles', link: 'https://www.deezer.com/artist/5313805' },
    album: {
      id: 932772571,
      title: 'Kiss All The Time',
      cover_xl: 'https://cdn-images.dzcdn.net/images/cover/hash/1000x1000.jpg',
      release_date: '2026-07-24',
      artist: { id: 5313805, name: 'Harry Styles' },
    },
    ...overrides,
  };
}

describe('Deezer preview provider', () => {
  it('reports the official preview duration and resolves playback by track id', () => {
    const song = deezerTrackToSong(track());

    expect(song).toMatchObject({
      id: 'deezer-3881984711',
      duration: 30,
      provider: 'Deezer Preview',
      path: '/api/music/deezer/stream/3881984711',
      licenseName: '30-second preview',
    });
    expect(song?.coverArt).toContain('cdn-images.dzcdn.net');
  });

  it('drops unreadable records and records without a preview', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        data: [track({ id: 1, readable: false }), track({ id: 2, preview: undefined }), track({ id: 3 })],
      }),
    );

    const songs = await deezerProvider.search('pop');

    expect(songs.map((song) => song.id)).toEqual(['deezer-3']);
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.pathname).toBe('/api/music/deezer/tracks');
    expect(url.searchParams.get('q')).toBe('pop');
  });

  it('uses album metadata when album-track rows omit their album object', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/tracks')) return Response.json({ data: [track({ album: null })] });
      return Response.json({ data: [track().album] });
    });

    const songs = await deezerProvider.getAlbumSongs('deezer-album-932772571');

    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({ album: 'Kiss All The Time', albumId: 'deezer-album-932772571' });
  });

  it('does not request an empty search', async () => {
    await expect(deezerProvider.search('  ')).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
