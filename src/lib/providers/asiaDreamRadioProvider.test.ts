import { describe, expect, it } from 'vitest';
import { asiaDreamRadioProvider } from './asiaDreamRadioProvider';

describe('Asia Dream Radio provider', () => {
  it('exposes stable, full-length J-pop stations without a discovery request', async () => {
    const stations = await asiaDreamRadioProvider.getTrending();

    expect(stations.map(({ id, title, path }) => ({ id, title, path }))).toEqual([
      {
        id: 'asiadream-jpop-sakura',
        title: 'J-Pop Sakura',
        path: 'https://quincy.torontocast.com:2070/stream.mp3',
      },
      {
        id: 'asiadream-jpop-powerplay',
        title: 'J-Pop Powerplay',
        path: 'https://kathy.torontocast.com:3560/stream/1/',
      },
      {
        id: 'asiadream-kawaii',
        title: 'J-Pop Kawaii',
        path: 'https://kathy.torontocast.com:3060/stream/1/',
      },
    ]);
    expect(stations.every((station) => station.isLive && station.duration === 0 && station.bitRate === 128)).toBe(true);
  });

  it('searches station metadata and resolves stable IDs locally', async () => {
    await expect(asiaDreamRadioProvider.search('kawaii')).resolves.toMatchObject([
      { id: 'asiadream-kawaii', title: 'J-Pop Kawaii' },
    ]);
    await expect(asiaDreamRadioProvider.getSongById('asiadream-jpop-sakura')).resolves.toMatchObject({
      title: 'J-Pop Sakura',
      isLive: true,
      provider: 'Asia Dream Radio',
    });
  });
});
