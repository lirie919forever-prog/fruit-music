import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wikimediaAudioToSong, wikimediaProvider, type WikimediaAudio } from './wikimediaProvider';

beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function audio(overrides: Partial<WikimediaAudio> = {}): WikimediaAudio {
  return {
    id: 175624708,
    title: 'File:River Dance Music.oga',
    url: 'https://upload.wikimedia.org/wikipedia/commons/0/02/River_Dance_Music.oga',
    descriptionUrl: 'https://commons.wikimedia.org/wiki/File:River_Dance_Music.oga',
    mime: 'application/ogg',
    duration: 318.43,
    size: 66_161_803,
    artist: 'Izi Music Production',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    date: '2025-07-05',
    categories: 'Music|Dance music',
    ...overrides,
  };
}

describe('Wikimedia Commons provider', () => {
  it('maps a licensed original file into a full stream route', () => {
    const song = wikimediaAudioToSong(audio());

    expect(song).toMatchObject({
      id: 'wikimedia-175624708',
      title: 'River Dance Music.oga',
      duration: 318,
      provider: 'Wikimedia Commons',
      contentType: 'audio/ogg',
      suffix: 'ogg',
      licenseName: 'CC BY',
      path: '/api/music/wikimedia/stream/175624708',
    });
  });

  it('omits short clips, unlicensed records, and files outside Commons uploads', () => {
    expect(wikimediaAudioToSong(audio({ duration: 30 }))).toBeNull();
    expect(wikimediaAudioToSong(audio({ licenseUrl: undefined }))).toBeNull();
    expect(wikimediaAudioToSong(audio({ url: 'https://example.com/track.ogg' }))).toBeNull();
  });

  it('uses the controlled catalog route for search and stable id lookups', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ results: [audio()] }))
      .mockResolvedValueOnce(Response.json({ results: [audio()] }));

    const searchResults = await wikimediaProvider.search('dance');
    const resolved = await wikimediaProvider.getSongById('wikimedia-175624708');

    expect(searchResults).toHaveLength(1);
    expect(resolved?.title).toBe('River Dance Music.oga');
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get('q')).toBe('dance');
    expect(new URL(String(vi.mocked(fetch).mock.calls[1][0])).searchParams.get('id')).toBe('175624708');
  });
});
