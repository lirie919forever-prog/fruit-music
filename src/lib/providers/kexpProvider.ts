import { createStaticRadioProvider } from './staticRadioProvider';

export const kexpProvider = createStaticRadioProvider({
  name: 'KEXP',
  idPrefix: 'kexp',
  artist: 'KEXP 90.3 FM',
  origin: 'https://www.kexp.org/listen/',
  coverKey: 'kexp',
  stations: [
    {
      id: '903',
      title: 'KEXP 90.3 FM',
      description: 'Seattle independent music radio, broadcasting live.',
      genre: 'Independent / Alternative',
      streamUrl: 'https://kexp-mp3-128.streamguys1.com/kexp128.mp3',
      bitRate: 128,
    },
  ],
});
