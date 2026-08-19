import { describe, expect, it } from 'vitest';
import { japanMusicRadioProvider } from './japanMusicRadioProvider';

describe('Japan Music Radio provider', () => {
  it('exposes curated Japanese-music live streams without discovery requests', async () => {
    const stations = await japanMusicRadioProvider.getTrending();

    expect(stations.map(({ id, title, artist, path }) => ({ id, title, artist, path }))).toEqual([
      {
        id: 'japanradio-j1-hits',
        title: 'J1 HITS',
        artist: 'J1 HITS',
        path: 'https://jenny.torontocast.com:2000/stream/J1HITS',
      },
      {
        id: 'japanradio-japan-city-pop',
        title: 'Japan City Pop',
        artist: 'BOX Japan City Pop',
        path: 'https://play.streamafrica.net/japancitypop',
      },
      {
        id: 'japanradio-radio',
        title: 'R/a/dio',
        artist: 'R/a/dio',
        path: 'https://relay0.r-a-d.io/main.mp3',
      },
      {
        id: 'japanradio-gensokyo',
        title: 'Gensokyo Radio',
        artist: 'Gensokyo Radio',
        path: 'https://stream.gensokyoradio.net/3',
      },
    ]);
    expect(stations.every((station) => station.isLive && station.duration === 0)).toBe(true);
  });

  it('finds a station locally by name and stable id', async () => {
    await expect(japanMusicRadioProvider.search('city pop')).resolves.toMatchObject([
      { id: 'japanradio-japan-city-pop', title: 'Japan City Pop' },
    ]);
    await expect(japanMusicRadioProvider.search('BOX Japan')).resolves.toMatchObject([
      { id: 'japanradio-japan-city-pop', artist: 'BOX Japan City Pop' },
    ]);
    await expect(japanMusicRadioProvider.getSongById('japanradio-j1-hits')).resolves.toMatchObject({
      title: 'J1 HITS',
      provider: 'Japan Music Radio',
      isLive: true,
    });
  });
});
