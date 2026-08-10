import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openverseAudioToSong, openverseProvider, type OpenverseAudio } from './openverseProvider';

beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function audio(overrides: Partial<OpenverseAudio> = {}): OpenverseAudio {
  return {
    id: '9e755b4d-4f1f-42db-a841-b8b2ebb583be',
    title: 'Midnight Jazz Beat',
    creator: 'Mazelo Nostra',
    creator_url: 'https://www.jamendo.com/artist/470592/Mazelo_Nostra',
    foreign_landing_url: 'https://www.jamendo.com/track/1543583',
    url: 'https://prod-1.storage.jamendo.com/?trackid=1543583&format=mp32',
    license_url: 'https://creativecommons.org/licenses/by-sa/3.0/',
    duration: 258_000,
    filetype: 'mp32',
    genres: ['jazz'],
    source: 'jamendo',
    mature: false,
    ...overrides,
  };
}

describe('Openverse provider', () => {
  it('maps milliseconds, direct audio, and the verified Creative Commons license', () => {
    const song = openverseAudioToSong(audio());

    expect(song).toMatchObject({
      id: 'openverse-9e755b4d-4f1f-42db-a841-b8b2ebb583be',
      duration: 258,
      provider: 'Openverse',
      contentType: 'audio/mpeg',
      suffix: 'mp3',
      licenseName: 'CC BY-SA',
    });
    expect(song?.path).toContain('prod-1.storage.jamendo.com');
  });

  it('omits mature, unlicensed, and unsupported audio records', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        results: [
          audio({ id: '11111111-1111-4111-8111-111111111111', mature: true }),
          audio({ id: '22222222-2222-4222-8222-222222222222', license_url: undefined }),
          audio({ id: '33333333-3333-4333-8333-333333333333', filetype: 'unknown', url: 'https://x.test/a' }),
          audio({
            id: '44444444-4444-4444-8444-444444444444',
            duration: 574,
            source: 'freesound',
            url: 'https://cdn.freesound.org/previews/19/19312_84709-hq.mp3',
          }),
          audio(),
        ],
      }),
    );

    const songs = await openverseProvider.search('jazz');

    expect(songs.map((song) => song.id)).toEqual(['openverse-9e755b4d-4f1f-42db-a841-b8b2ebb583be']);
  });

  it('resolves a stored song through the stable Openverse id', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ results: [audio()] }));

    const song = await openverseProvider.getSongById('openverse-9e755b4d-4f1f-42db-a841-b8b2ebb583be');

    expect(song?.title).toBe('Midnight Jazz Beat');
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get('id')).toBe(
      '9e755b4d-4f1f-42db-a841-b8b2ebb583be',
    );
  });
});
