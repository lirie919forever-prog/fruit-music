import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { qqMusicProvider, qqMusicSongToSong } from './qqMusicProvider';
import type { Song } from '@/types/music';

function record(overrides: Record<string, unknown> = {}) {
  return {
    songmid: '003b34Vx21nbbp',
    songid: 325852165,
    songname: 'Night Run',
    singer: [{ id: 4731886, mid: '001Erp1x1jDOoQ', name: 'Artist' }],
    albumid: 9615907,
    albummid: '002k2G8Z0j3wcO',
    albumname: 'Night Run',
    interval: 247,
    pubtime: 1622390400,
    stream: 1,
    pay: { payplay: 0 },
    ...overrides,
  };
}

function song(): Song {
  return qqMusicSongToSong(record())!;
}

beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('QQ Music provider', () => {
  it('maps a public catalog record into a verification-only full-length candidate', () => {
    const mapped = song();

    expect(mapped).toMatchObject({
      id: 'qq-003b34Vx21nbbp',
      provider: 'QQ Music',
      duration: 247,
      path: '/api/music/qq/stream/003b34Vx21nbbp',
      metadataVerified: true,
    });
    expect(mapped.coverArt).toBe('https://y.gtimg.cn/music/photo_new/T002R500x500M000002k2G8Z0j3wcO.jpg');
  });

  it('marks records the upstream says require paid playback as unavailable', () => {
    const mapped = qqMusicSongToSong(record({ pay: { payplay: 1 } }));

    expect(mapped?.playbackUnavailable).toBe(true);
  });

  it('uses the controlled search route and does not request an empty query', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ results: [record()] }));

    const results = await qqMusicProvider.search('artist');

    expect(results.map((item) => item.id)).toEqual(['qq-003b34Vx21nbbp']);
    const request = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(request.pathname).toBe('/api/music/qq/tracks');
    expect(request.searchParams.get('q')).toBe('artist');
    await expect(qqMusicProvider.search('   ')).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('requires a successful public-stream probe before returning a stream URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ available: true }));

    await expect(qqMusicProvider.getStreamUrl(song())).resolves.toBe('/api/music/qq/stream/003b34Vx21nbbp');
    const request = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(request.searchParams.get('probe')).toBe('1');
    expect(request.searchParams.get('expected')).toBe('247');
  });

  it('does not pretend a paid or unresolved record can play', async () => {
    await expect(qqMusicProvider.getStreamUrl({ ...song(), playbackUnavailable: true })).rejects.toThrow(
      'QQ Music stream is unavailable',
    );
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ available: false }));
    await expect(qqMusicProvider.getStreamUrl(song())).rejects.toThrow('QQ Music stream is unavailable');
  });
});
