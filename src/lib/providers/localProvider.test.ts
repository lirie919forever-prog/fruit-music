import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types/music';
import { loadLocalSong } from '@/lib/localMusic';
import { localProvider } from './localProvider';

vi.mock('@/lib/localMusic', () => ({
  loadLocalSong: vi.fn(),
}));

function song(path: string): Song {
  return {
    id: 'local-demo',
    title: 'Local demo',
    artist: 'Local artist',
    artistId: 'local-files',
    album: 'Local library',
    albumId: 'local-library',
    coverArt: '/placeholder-album.svg',
    duration: 120,
    track: 0,
    year: 0,
    genre: 'Local',
    path,
    bitRate: 0,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: 1,
    provider: 'Local file',
    sourceUrl: '',
    creatorUrl: '',
    licenseName: 'Local file',
    licenseUrl: '',
    attributionUrl: '',
    metadataVerified: true,
  };
}

beforeEach(() => {
  vi.mocked(loadLocalSong).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('local provider', () => {
  it('resolves a stale persisted object URL by stable local track id', async () => {
    const fresh = song('blob:current-document-url');
    vi.mocked(loadLocalSong).mockResolvedValue(fresh);

    await expect(localProvider.getStreamUrl(song('blob:stale-url'))).resolves.toBe(fresh.path);
    expect(loadLocalSong).toHaveBeenCalledWith(fresh.id);
  });

  it('keeps the stored path when the local record is unavailable', async () => {
    vi.mocked(loadLocalSong).mockResolvedValue(null);

    await expect(localProvider.getStreamUrl(song('blob:stale-url'))).resolves.toBe('blob:stale-url');
  });
});
