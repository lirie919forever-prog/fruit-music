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
    expect(song.recordingDuration).toBe(260);
    expect(song.licenseName).toBe('30-second preview');
  });

  it('requests artwork at a size worth displaying', () => {
    expect(trackToSong(track()).coverArt).toContain('/600x600bb.jpg');
  });

  it('streams through the proxy by track id, never a URL from the response', () => {
    expect(trackToSong(track()).path).toBe('/api/music/itunes/stream/1440872304');
  });

  it('keeps the catalog territory on a non-US preview stream', () => {
    expect(trackToSong(track(), 0, 30, 'jp').path).toBe('/api/music/itunes/stream/1440872304?country=jp');
    expect(trackToSong(track(), 0, 30, 'gb').path).toBe('/api/music/itunes/stream/1440872304?country=gb');
  });

  it('drops the collection and artist wrappers a track response carries', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        results: [
          { wrapperType: 'collection', collectionId: 1440871397, collectionName: 'Starboy' },
          { wrapperType: 'artist', artistId: 479756766, artistName: 'The Weeknd' },
          track(),
        ],
      }),
    );

    const songs = await itunesProvider.search('starboy');

    expect(songs.map((song) => song.id)).toEqual(['itunes-1440872304']);
  });

  it('drops a track with no preview instead of listing one that cannot play', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        results: [
          track({ previewUrl: undefined }),
          track({ trackId: 2, previewUrl: 'https://audio-ssl.itunes.apple.com/2.m4a' }),
        ],
      }),
    );

    const songs = await itunesProvider.search('starboy');

    expect(songs.map((song) => song.id)).toEqual(['itunes-2']);
  });

  it('orders album tracks by track number, not by the order Apple returned them', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        results: [
          track({ trackId: 3, trackNumber: 3 }),
          track({ trackId: 1, trackNumber: 1 }),
          track({ trackId: 2, trackNumber: 2 }),
        ],
      }),
    );

    const songs = await itunesProvider.getAlbumSongs('itunes-album-1440871397');

    expect(songs.map((song) => song.track)).toEqual([1, 2, 3]);
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get('id')).toBe('1440871397');
  });

  it('returns batched ids in the order they were asked for', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        results: [track({ trackId: 30 }), track({ trackId: 10 }), track({ trackId: 20 })],
      }),
    );

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

  it('builds the recent-release rail from the newest playable Apple results', async () => {
    let call = 0;
    vi.mocked(fetch).mockImplementation(() => {
      const index = call++;
      const results =
        index === 0
          ? [track({ trackId: 1, releaseDate: '2026-01-03T08:00:00Z' })]
          : index === 1
            ? [track({ trackId: 2, releaseDate: '2026-06-15T08:00:00Z' })]
            : index === 2
              ? [track({ trackId: 1, releaseDate: '2026-01-03T08:00:00Z' })]
              : [];
      return Promise.resolve(Response.json({ results }));
    });

    const songs = await itunesProvider.getRecentReleases(2);

    expect(songs.map((song) => song.id)).toEqual(['itunes-2', 'itunes-1']);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(10);
    expect(vi.mocked(fetch).mock.calls.map(([input]) => new URL(String(input)).searchParams.get('country'))).toEqual([
      'jp',
      'us',
      'jp',
      'us',
      'jp',
      'us',
      'jp',
      'us',
      'jp',
      'us',
    ]);
  });

  it('derives searched artists from albums, because Apple ships artist records with no artwork', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        results: [
          {
            wrapperType: 'collection',
            collectionId: 1,
            collectionName: 'Starboy',
            artistId: 479756766,
            artistName: 'The Weeknd',
            artworkUrl100: 'https://is1-ssl.mzstatic.com/a/100x100bb.jpg',
          },
          {
            wrapperType: 'collection',
            collectionId: 2,
            collectionName: 'Dawn FM',
            artistId: 479756766,
            artistName: 'The Weeknd',
            artworkUrl100: 'https://is1-ssl.mzstatic.com/b/100x100bb.jpg',
          },
        ],
      }),
    );

    const artists = await itunesProvider.searchArtists('weeknd');

    // Both albums fold into one artist, and that artist has a real cover.
    expect(artists).toHaveLength(1);
    expect(artists[0]).toMatchObject({ id: 'itunes-artist-479756766', name: 'The Weeknd', albumCount: 2 });
    expect(artists[0].coverArt).toContain('/600x600bb.jpg');
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get('entity')).toBe('album');
  });

  it('collapses the same release reissued under a second collection id', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        results: [
          {
            wrapperType: 'collection',
            collectionId: 7,
            collectionName: 'Starboy',
            artistId: 1,
            artistName: 'A',
            trackCount: 18,
          },
          {
            wrapperType: 'collection',
            collectionId: 8,
            collectionName: 'Starboy',
            artistId: 1,
            artistName: 'A',
            trackCount: 18,
          },
          {
            wrapperType: 'collection',
            collectionId: 9,
            collectionName: 'Starboy (Deluxe)',
            artistId: 1,
            artistName: 'A',
            trackCount: 20,
          },
        ],
      }),
    );

    // Different ids, same name and artist — one tile. A deluxe edition has a
    // different name and stays.
    await expect(itunesProvider.searchAlbums('starboy')).resolves.toHaveLength(2);
  });

  it("keeps a discography to the artist's own records, not everything they feature on", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        results: [
          { wrapperType: 'artist', artistId: 5468295, artistName: 'Daft Punk' },
          {
            wrapperType: 'collection',
            collectionId: 1,
            collectionName: 'Discovery',
            artistId: 5468295,
            artistName: 'Daft Punk',
            releaseDate: '2001-03-12T08:00:00Z',
          },
          // Credited to Daft Punk, but it is The Weeknd's single.
          {
            wrapperType: 'collection',
            collectionId: 2,
            collectionName: 'Starboy (feat. Daft Punk)',
            artistId: 479756766,
            artistName: 'The Weeknd',
            releaseDate: '2016-11-25T08:00:00Z',
          },
        ],
      }),
    );

    const albums = await itunesProvider.getArtistAlbums('itunes-artist-5468295');

    expect(albums.map((album) => album.name)).toEqual(['Discovery']);
  });

  it('orders a discography newest first', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        results: [
          { wrapperType: 'artist', artistId: 479756766, artistName: 'The Weeknd' },
          {
            wrapperType: 'collection',
            collectionId: 1,
            collectionName: 'Starboy',
            artistId: 479756766,
            artistName: 'The Weeknd',
            releaseDate: '2016-11-25T08:00:00Z',
          },
          {
            wrapperType: 'collection',
            collectionId: 2,
            collectionName: 'Dawn FM',
            artistId: 479756766,
            artistName: 'The Weeknd',
            releaseDate: '2022-01-07T08:00:00Z',
          },
          {
            wrapperType: 'collection',
            collectionId: 3,
            collectionName: 'After Hours',
            artistId: 479756766,
            artistName: 'The Weeknd',
            releaseDate: '2020-03-20T08:00:00Z',
          },
        ],
      }),
    );

    const albums = await itunesProvider.getArtistAlbums('itunes-artist-479756766');

    // The artist wrapper is not an album and must not become a blank tile.
    expect(albums.map((album) => album.name)).toEqual(['Dawn FM', 'After Hours', 'Starboy']);
  });

  it('does not spend a request on an empty album or artist search', async () => {
    await expect(itunesProvider.searchAlbums('  ')).resolves.toEqual([]);
    await expect(itunesProvider.searchArtists('')).resolves.toEqual([]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('keeps the shelf populated when one browse seed fails', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(
        Response.json({
          results: [
            {
              wrapperType: 'collection',
              collectionId: 1440871397,
              collectionName: 'Starboy',
              artistId: 479756766,
              artistName: 'The Weeknd',
              artworkUrl100: 'https://is1-ssl.mzstatic.com/image/100x100bb.jpg',
              trackCount: 18,
              releaseDate: '2016-11-25T08:00:00Z',
              primaryGenreName: 'R&B/Soul',
            },
          ],
        }),
      );

    const albums = await itunesProvider.getAlbums();

    expect(albums.length).toBeGreaterThan(0);
    expect(albums[0]).toMatchObject({ id: 'itunes-album-1440871397', name: 'Starboy', songCount: 18 });
  });
});
