import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ntsProvider } from './ntsProvider';

beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function station() {
  return {
    id: '1',
    title: 'NTS 1',
    description: 'A live channel from London.',
    genre: 'Electronic, Soul',
    nowPlaying: 'Morning transmission',
  };
}

describe('NTS Radio provider', () => {
  it('maps the official live channel into a non-seekable 256 kbps stream', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ results: [station()] }));

    const [song] = await ntsProvider.getTrending();

    expect(song).toMatchObject({
      id: 'nts-1',
      title: 'NTS 1',
      album: 'Morning transmission',
      duration: 0,
      isLive: true,
      provider: 'NTS Radio',
      path: 'https://stream-relay-geo.ntslive.net/stream',
      bitRate: 256,
    });
  });

  it('searches the controlled station catalog and resolves a stable channel ID', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ results: [station()] }))
      .mockResolvedValueOnce(Response.json({ results: [station()] }));

    await ntsProvider.search('electronic');
    const resolved = await ntsProvider.getSongById('nts-1');

    expect(resolved?.title).toBe('NTS 1');
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).pathname).toBe('/api/music/nts/stations');
    expect(new URL(String(vi.mocked(fetch).mock.calls[1][0])).searchParams.get('id')).toBe('1');
  });
});
