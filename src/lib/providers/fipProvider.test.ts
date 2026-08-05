import { describe, expect, it } from 'vitest';
import { fipProvider } from './fipProvider';

describe('FIP provider', () => {
  it('exposes official non-seekable 128 kbps live channels', async () => {
    const stations = await fipProvider.getTrending();

    expect(stations.map(({ id, path }) => ({ id, path }))).toEqual([
      { id: 'fip-main', path: 'https://icecast.radiofrance.fr/fip-midfi.mp3' },
      { id: 'fip-rock', path: 'https://icecast.radiofrance.fr/fiprock-midfi.mp3' },
      { id: 'fip-jazz', path: 'https://icecast.radiofrance.fr/fipjazz-midfi.mp3' },
    ]);
    expect(stations.every((station) => station.isLive && station.duration === 0 && station.bitRate === 128)).toBe(true);
  });

  it('searches genre metadata and resolves a stable station ID without a network request', async () => {
    await expect(fipProvider.search('jazz')).resolves.toMatchObject([{ id: 'fip-jazz', title: 'FIP Jazz' }]);
    await expect(fipProvider.getSongById('fip-rock')).resolves.toMatchObject({
      title: 'FIP Rock',
      isLive: true,
    });
  });
});
