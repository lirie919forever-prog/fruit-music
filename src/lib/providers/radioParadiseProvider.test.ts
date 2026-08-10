import { describe, expect, it } from 'vitest';
import { radioParadiseProvider } from './radioParadiseProvider';

describe('Radio Paradise provider', () => {
  it('exposes official non-seekable 192 kbps live channels', async () => {
    const [station] = await radioParadiseProvider.getTrending();

    expect(station).toMatchObject({
      id: 'radioparadise-main',
      title: 'Radio Paradise',
      duration: 0,
      isLive: true,
      provider: 'Radio Paradise',
      path: 'https://stream.radioparadise.com/mp3-192',
      bitRate: 192,
    });
  });

  it('supports station search and stable ID lookups without a network dependency', async () => {
    const matches = await radioParadiseProvider.search('global');
    const resolved = await radioParadiseProvider.getSongById('radioparadise-global');

    expect(matches.map((song) => song.id)).toEqual(['radioparadise-global']);
    expect(resolved?.path).toBe('https://stream.radioparadise.com/global-192');
  });
});
