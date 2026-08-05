import { createStaticRadioProvider } from './staticRadioProvider';

export const theCurrentProvider = createStaticRadioProvider({
  name: 'The Current',
  idPrefix: 'thecurrent',
  artist: 'The Current',
  origin: 'https://www.thecurrent.org/listen/',
  coverKey: 'the-current',
  stations: [
    {
      id: 'main',
      title: 'The Current',
      description: 'Minnesota Public Radio music discovery, broadcasting live.',
      genre: 'Alternative / Indie',
      streamUrl: 'https://current.stream.publicradio.org/current.mp3',
      bitRate: 128,
    },
  ],
});
