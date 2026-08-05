import { describe, expect, it } from 'vitest';
import { theCurrentProvider } from './theCurrentProvider';

describe('The Current provider', () => {
  it('exposes the official non-seekable 128 kbps live stream', async () => {
    const [station] = await theCurrentProvider.getTrending();

    expect(station).toMatchObject({
      id: 'thecurrent-main',
      title: 'The Current',
      duration: 0,
      isLive: true,
      provider: 'The Current',
      path: 'https://current.stream.publicradio.org/current.mp3',
      bitRate: 128,
    });
  });

  it('searches its local station catalog and resolves a stable ID without a network request', async () => {
    await expect(theCurrentProvider.search('alternative')).resolves.toMatchObject([{ id: 'thecurrent-main' }]);
    await expect(theCurrentProvider.getSongById('thecurrent-main')).resolves.toMatchObject({
      title: 'The Current',
      isLive: true,
    });
  });
});
