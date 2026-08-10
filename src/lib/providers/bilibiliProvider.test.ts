import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bilibiliItemToSong, bilibiliProvider, parseBilibiliDuration } from './bilibiliProvider';

type SearchItem = Parameters<typeof bilibiliItemToSong>[0];

const BVID = 'BV1z79YBtEhh';

function item(overrides: Partial<SearchItem> = {}): SearchItem {
  return {
    bvid: BVID,
    title: "ILLIT It's Me",
    author: 'ILLIT',
    duration: '2:27',
    typename: 'Music',
    mid: 123,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Bilibili provider', () => {
  it('parses durations and normalizes a full-length upload', () => {
    expect(parseBilibiliDuration('1:02:03')).toBe(3723);

    const song = bilibiliItemToSong(
      item({
        title: '<em class="keyword">ILLIT</em> It&#x27;s Me',
        duration: '2:27',
      }),
    );

    expect(song).toMatchObject({
      id: `bilibili-${BVID}`,
      title: "ILLIT It's Me",
      artist: 'ILLIT',
      duration: 147,
      path: `/api/music/bilibili/stream/${BVID}`,
      provider: 'Bilibili',
      sourceUrl: `https://www.bilibili.com/video/${BVID}`,
    });
    expect(song?.metadataVerified).toBe(false);
  });

  it('drops short clips and obvious alternate uploads before they enter search', () => {
    expect(bilibiliItemToSong(item({ duration: '0:30' }))).toBeNull();
    expect(bilibiliItemToSong(item({ title: "ILLIT It's Me dance practice" }))).toBeNull();
  });

  it('searches through the local proxy and preserves the requested limit', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ results: [item()] }));

    const [song] = await bilibiliProvider.search("ILLIT It's Me");

    expect(song.id).toBe(`bilibili-${BVID}`);
    const [url] = vi.mocked(fetch).mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe('/api/music/bilibili/tracks');
    expect(parsed.searchParams.get('q')).toBe("ILLIT It's Me");
    expect(parsed.searchParams.get('limit')).toBe('40');
  });

  it('requires a positive full-track probe before returning a stream path', async () => {
    const song = bilibiliItemToSong(item())!;
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ available: true, provider: 'Bilibili' }));

    await expect(bilibiliProvider.getStreamUrl(song)).resolves.toBe(song.path);
    const [url] = vi.mocked(fetch).mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe(`/api/music/bilibili/stream/${BVID}`);
    expect(parsed.searchParams.get('probe')).toBe('1');
    expect(parsed.searchParams.get('expected')).toBe('147');
  });

  it('does not expose an unavailable or paywalled result as playable', async () => {
    const song = bilibiliItemToSong(item({ is_pay: 1 }))!;
    await expect(bilibiliProvider.getStreamUrl(song)).rejects.toThrow('Bilibili stream is unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });
});
