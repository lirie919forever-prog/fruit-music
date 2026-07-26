import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lxmusicProvider } from './lxmusicProvider';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
  process.env.LX_API_BASE = 'https://lx.xiaomusic.dpdns.org';
  delete process.env.NEXT_PUBLIC_LX_DEFAULT_LEVEL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.LX_API_BASE;
  delete process.env.NEXT_PUBLIC_LX_DEFAULT_LEVEL;
});

describe('LX Music provider', () => {
  it('returns empty array for blank search query', async () => {
    const result = await lxmusicProvider.search('');
    expect(result).toEqual([]);
  });

  it('handles upstream code !== 0', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ code: 6, msg: 'unknown', data: null }));
    const result = await lxmusicProvider.search('test');
    expect(result).toEqual([]);
  });

  it('returns empty array for no result array', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ code: 0, data: { total: 0, result: [] } })
    );
    const result = await lxmusicProvider.search('nonexistent');
    expect(result).toEqual([]);
  });

  it('maps LX search results to Song objects', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        code: 0,
        data: {
          total: 1,
          result: [
            {
              id: '186016',
              name: '晴天',
              ar: [{ name: 'Jay Chou', id: '9527' }],
              al: { name: '叶惠美', picUrl: 'https://example.com/cover.jpg', id: '12345' },
              dt: 269000,
              platform: 'wy',
              type: 1,
              privilege: { level: 320 },
            },
          ],
        },
      })
    );

    const result = await lxmusicProvider.search('晴天');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'lxmusic-wy_1_186016',
      title: '晴天',
      artist: 'Jay Chou',
      artistId: 'lxmusic-artist-wy_9527',
      album: '叶惠美',
      albumId: 'lxmusic-album-wy_12345',
      // The artwork host is not one the image optimizer is configured for in a
      // default build, so it degrades to the placeholder rather than rendering
      // as a broken tile. LX's own host is allowed only when the feature is
      // enabled, which matches how the README describes it.
      coverArt: '/placeholder-album.svg',
      duration: 269,
      bitRate: 320,
      provider: 'LX Music',
      metadataVerified: false,
      licenseName: 'Source terms',
    });
    expect(result[0].path).toContain('/api/music/lxmusic/url?id=lxmusic-wy_1_186016&level=320&platform=wy&rawId=186016&type=1');
  });

  it('falls back to 320k when no privilege data', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        code: 0,
        data: {
          total: 1,
          result: [
            { id: '1', name: 'Song', ar: [{ name: 'A' }], al: { name: 'Al' }, dt: 180000, platform: 'tx', type: 1 },
          ],
        },
      })
    );
    const result = await lxmusicProvider.search('song');
    expect(result[0].bitRate).toBe(320);
    expect(result[0].id).toBe('lxmusic-tx_1_1');
  });

  it('uses wy as default platform when missing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        code: 0,
        data: {
          total: 1,
          result: [
            { id: '99', name: 'Noplat', ar: [{ name: 'A' }], al: { name: 'Al' }, dt: 100000, type: 1 },
          ],
        },
      })
    );
    const result = await lxmusicProvider.search('noplat');
    expect(result[0].id).toBe('lxmusic-wy_1_99');
  });

  it('returns empty array when all trending terms fail', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('error', { status: 500 }));
    vi.mocked(fetch).mockResolvedValueOnce(new Response('error', { status: 500 }));
    vi.mocked(fetch).mockResolvedValueOnce(new Response('error', { status: 500 }));
    const result = await lxmusicProvider.getTrending(10);
    expect(result).toEqual([]);
  });

  it('returns first batch from first successful trending term', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        code: 0,
        data: {
          total: 60,
          result: Array.from({ length: 60 }, (_, i) => ({
            id: String(i), name: `Song ${i}`, ar: [{ name: 'A' }], al: { name: 'Al' }, dt: 180000, platform: 'wy', type: 1,
          })),
        },
      })
    );
    const result = await lxmusicProvider.getTrending(50);
    expect(result).toHaveLength(50);
    expect(result[0].id).toBe('lxmusic-wy_1_0');
  });

  it('getStreamUrl returns song.path', async () => {
    const song = {
      id: 'lxmusic-test', title: 'Test', artist: 'A', artistId: 'aid', album: 'Alb', albumId: 'alid',
      coverArt: '/p', duration: 10, track: 0, year: 0, genre: '', path: '/api/music/lxmusic/url?id=x',
      bitRate: 320, contentType: 'audio/mpeg', suffix: 'mp3', size: 0,
      provider: 'LX Music' as const, sourceUrl: '', creatorUrl: '', licenseName: '', licenseUrl: '', attributionUrl: '', metadataVerified: true,
    };
    expect(await lxmusicProvider.getStreamUrl(song)).toBe(song.path);
  });

  it('handles empty ar array', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        code: 0,
        data: {
          total: 1,
          result: [
            { id: '5', name: 'NoArtist', ar: [], al: { name: 'Al' }, dt: 100000, platform: 'kg', type: 1 },
          ],
        },
      })
    );
    const result = await lxmusicProvider.search('noartist');
    expect(result[0].artist).toBe('Unknown');
    expect(result[0].artistId).toBe('lxmusic-artist-kg_unknown');
  });

  it('coerces numeric artist/album ids', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        code: 0,
        data: {
          total: 1,
          result: [
            { id: '10', name: 'Song', ar: [{ name: 'A', id: 9527 }], al: { name: 'Al', id: 'alb1' }, dt: 100000, platform: 'kw', type: 1 },
          ],
        },
      })
    );
    const result = await lxmusicProvider.search('song');
    expect(result[0].artistId).toBe('lxmusic-artist-kw_9527');
    expect(result[0].albumId).toBe('lxmusic-album-kw_alb1');
  });

  it('joins multiple artists by slash', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        code: 0,
        data: {
          total: 1,
          result: [
            { id: '11', name: 'Collab', ar: [{ name: 'A' }, { name: 'B' }], al: { name: 'Al' }, dt: 100000, platform: 'mg', type: 1 },
          ],
        },
      })
    );
    const result = await lxmusicProvider.search('collab');
    expect(result[0].artist).toBe('A / B');
  });
});
