import { describe, expect, it } from 'vitest';
import { kexpProvider } from './kexpProvider';

describe('KEXP provider', () => {
  it('exposes the official non-seekable 128 kbps live stream', async () => {
    const [station] = await kexpProvider.getTrending();

    expect(station).toMatchObject({
      id: 'kexp-903',
      title: 'KEXP 90.3 FM',
      duration: 0,
      isLive: true,
      provider: 'KEXP',
      path: 'https://kexp-mp3-128.streamguys1.com/kexp128.mp3',
      bitRate: 128,
    });
  });

  it('searches its local station catalog and resolves stable IDs without a network request', async () => {
    await expect(kexpProvider.search('alternative')).resolves.toMatchObject([{ id: 'kexp-903' }]);
    await expect(kexpProvider.getSongById('kexp-903')).resolves.toMatchObject({
      title: 'KEXP 90.3 FM',
      isLive: true,
    });
  });
});
