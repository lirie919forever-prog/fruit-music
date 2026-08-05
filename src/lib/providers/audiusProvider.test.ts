import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audiusProvider, audiusTrackToSong, type AudiusTrack } from './audiusProvider';

beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function track(overrides: Partial<AudiusTrack> = {}): AudiusTrack {
  return {
    id: 'Evw5wAJ',
    title: 'Come On',
    duration: 181,
    genre: 'Electronic',
    release_date: '2026-07-23T18:22:34Z',
    is_available: true,
    is_streamable: true,
    is_stream_gated: false,
    permalink: '/phuture/come-on',
    user: { id: 'Wem1e', name: 'Phuture Collective', handle: 'phuture', is_available: true },
    ...overrides,
  };
}

describe('Audius provider', () => {
  it('keeps the full duration and uses Audius to select the creator stream node', () => {
    const song = audiusTrackToSong(track());

    expect(song).toMatchObject({
      id: 'audius-Evw5wAJ',
      duration: 181,
      provider: 'Audius',
      licenseName: 'Creator-published stream',
      path: 'https://api.audius.co/v1/tracks/Evw5wAJ/stream?app_name=marea',
    });
    expect(song?.coverArt).toMatch(/^data:image\/svg\+xml/);
  });

  it('uses the creator artwork when Audius returns an approved content URL', () => {
    const song = audiusTrackToSong(
      track({
        artwork: {
          '150x150': 'https://audius-content-12.figment.io/content/cid/150x150.jpg',
          '480x480': 'https://audius-content-12.figment.io/content/cid/480x480.jpg',
        },
      }),
    );

    expect(song?.coverArt).toBe('https://audius-content-12.figment.io/content/cid/480x480.jpg');
  });

  it('keeps artwork served by the live Audius validator mesh', () => {
    const song = audiusTrackToSong(
      track({
        artwork: {
          '1000x1000': 'https://val011.open-audio-validator.com/content/cid/1000x1000.jpg',
        },
      }),
    );

    expect(song?.coverArt).toBe('https://val011.open-audio-validator.com/content/cid/1000x1000.jpg');
  });

  it('uses a fresh Audius redirect URL for every playback attempt', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_785_222_409_000);
    const song = audiusTrackToSong(track())!;

    const first = new URL(await audiusProvider.getStreamUrl(song));
    const second = new URL(await audiusProvider.getStreamUrl(song));

    expect(first.origin).toBe('https://api.audius.co');
    expect(first.pathname).toBe('/v1/tracks/Evw5wAJ/stream');
    expect(first.searchParams.get('app_name')).toBe('marea');
    expect(first.searchParams.get('marea_request')).toMatch(/^m.*-\d+$/);
    expect(second.searchParams.get('marea_request')).not.toBe(first.searchParams.get('marea_request'));
  });

  it('omits unavailable, gated, and non-streamable tracks', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        data: [
          track({ id: 'unavailable', is_available: false }),
          track({ id: 'gated', is_stream_gated: true }),
          track({ id: 'nostream', is_streamable: false }),
          track({ id: 'playable' }),
        ],
      }),
    );

    const songs = await audiusProvider.getTrending();

    expect(songs.map((song) => song.id)).toEqual(['audius-playable']);
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get('trending')).toBe('1');
  });

  it('routes album tracks through a controlled album-id catalog request', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: [track()] }));

    const songs = await audiusProvider.getAlbumSongs('audius-album-79yV0vg');

    expect(songs).toHaveLength(1);
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get('album_id')).toBe('79yV0vg');
  });

  it('does not request an empty search', async () => {
    await expect(audiusProvider.search('')).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
