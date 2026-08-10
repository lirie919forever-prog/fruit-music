import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { somaFmProvider } from './somaFmProvider';

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
    id: '7soul',
    title: 'Seven Inch Soul',
    description: 'Vintage soul tracks from original 45 RPM vinyl.',
    genre: 'oldies',
    lastPlaying: "Esther Philips - Baby, I'm For Real",
  };
}

describe('SomaFM provider', () => {
  it('maps an official station into a non-seekable full live stream', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ results: [station()] }));

    const [song] = await somaFmProvider.getTrending();

    expect(song).toMatchObject({
      id: 'somafm-7soul',
      title: 'Seven Inch Soul',
      duration: 0,
      isLive: true,
      provider: 'SomaFM',
      path: '/api/music/somafm/stream/7soul',
      contentType: 'audio/mpeg',
    });
  });

  it('uses controlled station search and stable id lookups', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ results: [station()] }))
      .mockResolvedValueOnce(Response.json({ results: [station()] }));

    await somaFmProvider.search('soul');
    const resolved = await somaFmProvider.getSongById('somafm-7soul');

    expect(resolved?.title).toBe('Seven Inch Soul');
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get('q')).toBe('soul');
    expect(new URL(String(vi.mocked(fetch).mock.calls[1][0])).searchParams.get('id')).toBe('7soul');
  });
});
