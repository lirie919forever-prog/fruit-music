import { describe, expect, it } from 'vitest';
import { radioFranceProvider } from './radioFranceProvider';

describe('Radio France provider', () => {
  it('exposes official 128 kbps live stations', async () => {
    const stations = await radioFranceProvider.getTrending();

    expect(stations.map(({ id, title, path }) => ({ id, title, path }))).toEqual([
      {
        id: 'radiofrance-mouv',
        title: "Mouv'",
        path: 'https://icecast.radiofrance.fr/mouv-midfi.mp3',
      },
      {
        id: 'radiofrance-france-inter',
        title: 'France Inter',
        path: 'https://icecast.radiofrance.fr/franceinter-midfi.mp3',
      },
      {
        id: 'radiofrance-france-musique',
        title: 'France Musique',
        path: 'https://icecast.radiofrance.fr/francemusique-midfi.mp3',
      },
    ]);
    expect(stations.every((station) => station.isLive && station.duration === 0 && station.bitRate === 128)).toBe(true);
  });

  it('searches station metadata and resolves stable IDs without a network request', async () => {
    await expect(radioFranceProvider.search('classical')).resolves.toMatchObject([
      { id: 'radiofrance-france-musique', title: 'France Musique' },
    ]);
    await expect(radioFranceProvider.getSongById('radiofrance-mouv')).resolves.toMatchObject({
      title: "Mouv'",
      isLive: true,
      sourceUrl: 'https://www.radiofrance.fr/mouv',
    });
    await expect(radioFranceProvider.getSongById('radiofrance-invalid')).resolves.toBeNull();
  });
});
