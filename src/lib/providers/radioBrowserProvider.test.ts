import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { radioBrowserProvider } from './radioBrowserProvider';

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
    id: 'c76686ca-a8b9-4db9-9839-1470c9599623',
    name: 'Classic Vinyl HD',
    streamUrl: 'https://icecast.walmradio.com:8443/classic',
    homepage: 'https://www.walmradio.com/',
    tags: 'classic rock,music,vinyl',
    codec: 'audio/mpeg',
    bitrate: 320,
    countryCode: 'US',
  };
}

describe('Radio Browser provider', () => {
  it('maps a checked public station into a non-seekable full live stream', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ results: [station()] }));

    const [song] = await radioBrowserProvider.getTrending();

    expect(song).toMatchObject({
      id: 'radio-c76686ca-a8b9-4db9-9839-1470c9599623',
      title: 'Classic Vinyl HD',
      duration: 0,
      isLive: true,
      provider: 'Radio Browser',
      path: 'https://icecast.walmradio.com:8443/classic',
      contentType: 'audio/mpeg',
    });
  });

  it('uses controlled tag search and stable station id lookups', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ results: [station()] }))
      .mockResolvedValueOnce(Response.json({ results: [station()] }));

    await radioBrowserProvider.getSongsByTag('rock');
    const resolved = await radioBrowserProvider.getSongById('radio-c76686ca-a8b9-4db9-9839-1470c9599623');

    expect(resolved?.title).toBe('Classic Vinyl HD');
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get('tag')).toBe('rock');
    expect(new URL(String(vi.mocked(fetch).mock.calls[1][0])).searchParams.get('id')).toBe(
      'c76686ca-a8b9-4db9-9839-1470c9599623',
    );
  });

  it('uses an exact country selector for a Japan radio lane', async () => {
    const japan = { ...station(), countryCode: 'JP' };
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ results: [japan] }));

    const stations = await radioBrowserProvider.getCountryStations('jp', 8);

    expect(stations[0]).toMatchObject({ artist: 'JP live radio', provider: 'Radio Browser' });
    const request = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(request.searchParams.get('country')).toBe('JP');
    expect(request.searchParams.get('limit')).toBe('8');
  });

  it('does not call the API for an invalid country selector', async () => {
    await expect(radioBrowserProvider.getCountryStations('Japan')).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refreshes a persisted station URL by stable ID before playback', async () => {
    const current = station();
    current.streamUrl = 'https://stream.example.com/current.mp3';
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ results: [station()] }))
      .mockResolvedValueOnce(Response.json({ results: [current] }));

    const [persisted] = await radioBrowserProvider.getTrending();

    await expect(radioBrowserProvider.getStreamUrl(persisted)).resolves.toBe(current.streamUrl);
    expect(new URL(String(vi.mocked(fetch).mock.calls[1][0])).searchParams.get('id')).toBe(
      'c76686ca-a8b9-4db9-9839-1470c9599623',
    );
  });
});
