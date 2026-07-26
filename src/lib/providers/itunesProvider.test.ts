import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { itunesProvider, trackToSong } from './itunesProvider';

beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function track(overrides: Record<string, unknown> = {}) {
  return {
    wrapperType: 'track',
    kind: 'song',
    trackId: 1440872304,
    trackName: 'Die For You',
    artistId: 479756766,
    artistName: 'The Weeknd',
    collectionId: 1440871397,
    collectionName: 'Starboy',
    artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/e2/100x100bb.jpg',
    previewUrl: 'https://audio-ssl.itunes.apple.com/preview.m4a',
    trackNumber: 3,
    releaseDate: '2016-11-25T08:00:00Z',
    primaryGenreName: 'R&B/Soul',
    trackTimeMillis: 260253,
    ...overrides,
  };
}

describe('Apple preview provider', () => {
  it('reports the duration that actually plays rather than the length of the full track', () => {
    const song = trackToSong(track());

    // trackTimeMillis is 4:20; the preview is 30 seconds. Showing 4:20 beside a
    // row that stops at 0:30 would be the one number the listener trusts.
    expect(song.duration).toBe(30);
    expect(song.licenseName).toBe('30-second preview');
  });

  it('requests artwork at a size worth displaying', () => {
    expect(trackToSong(track()).coverArt).toContain('/600x600bb.jpg');
  });

  it('streams through the proxy by track id, never a URL from the response', () => {
    expect(trackToSong(track()).path).toBe('/api/music/itunes/stream/1440872304');
  });

  it('drops the collection and artist wrappers a track response carries', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      results: [
        { wrapperType: 'collection', collectionId: 1440871397, collectionName: 'Starboy' },
        { wrapperType: 'artist', artistId: 479756766, artistName: 'The Weeknd' },
        track(),
      ],
    }));

    const songs = await itunesProvider.search('starboy');

    expect(songs.map((song) => song.id)).toEqual(['itunes-1440872304']);
  });

  it('drops a track with no preview instead of listing one that cannot play', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      results: [track({ previewUrl: undefined }), track({ trackId: 2, previewUrl: 'https://audio-ssl.itunes.apple.com/2.m4a' })],
    }));

    const songs = await itunesProvider.search('starboy');

    expect(songs.map((song) => song.id)).toEqual(['itunes-2']);
  });

  it('orders album tracks by track number, not by the order Apple returned them', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      results: [
        track({ trackId: 3, trackNumber: 3 }),
        track({ trackId: 1, trackNumber: 1 }),
        track({ trackId: 2, trackNumber: 2 }),
      ],
    }));

    const songs = await itunesProvider.getAlbumSongs('itunes-album-1440871397');

    expect(songs.map((song) => song.track)).toEqual([1, 2, 3]);
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get('id')).toBe('1440871397');
  });

  it('returns batched ids in the order they were asked for', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      results: [track({ trackId: 30 }), track({ trackId: 10 }), track({ trackId: 20 })],
    }));

    const songs = await itunesProvider.getSongsByIds(['10', '20', '30']);

    expect(songs.map((song) => song.id)).toEqual(['itunes-10', 'itunes-20', 'itunes-30']);
  });

  it('keeps the ids that resolved when one lookup chunk fails', async () => {
    const ids = Array.from({ length: 60 }, (_, index) => String(index + 1));
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ results: [track({ trackId: 1 })] }))
      .mockRejectedValueOnce(new Error('down'));

    const songs = await itunesProvider.getSongsByIds(ids);

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(songs.map((song) => song.id)).toEqual(['itunes-1']);
  });

  it('does not spend a request on an empty search', async () => {
    await expect(itunesProvider.search('   ')).resolves.toEqual([]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('keeps the shelf populated when one browse seed fails', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(Response.json({
        results: [{
          wrapperType: 'collection',
          collectionId: 1440871397,
          collectionName: 'Starboy',
          artistId: 479756766,
          artistName: 'The Weeknd',
          artworkUrl100: 'https://is1-ssl.mzstatic.com/image/100x100bb.jpg',
          trackCount: 18,
          releaseDate: '2016-11-25T08:00:00Z',
          primaryGenreName: 'R&B/Soul',
        }],
      }));

    const albums = await itunesProvider.getAlbums();

    expect(albums.length).toBeGreaterThan(0);
    expect(albums[0]).toMatchObject({ id: 'itunes-album-1440871397', name: 'Starboy', songCount: 18 });
  });
});
