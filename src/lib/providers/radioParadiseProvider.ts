import { createStaticRadioProvider } from './staticRadioProvider';

const RADIO_PARADISE_ORIGIN = 'https://radioparadise.com';

export const radioParadiseProvider = createStaticRadioProvider({
  name: 'Radio Paradise',
  idPrefix: 'radioparadise',
  artist: 'Radio Paradise',
  origin: RADIO_PARADISE_ORIGIN,
  coverKey: 'radio-paradise',
  stations: [
    {
      id: 'main',
      title: 'Radio Paradise',
      description: 'An eclectic mix of modern and classic music.',
      genre: 'Eclectic',
      streamUrl: 'https://stream.radioparadise.com/mp3-192',
      bitRate: 192,
    },
    {
      id: 'mellow',
      title: 'Radio Paradise Mellow Mix',
      description: 'A calmer blend of modern and classic music.',
      genre: 'Mellow',
      streamUrl: 'https://stream.radioparadise.com/mellow-192',
      bitRate: 192,
    },
    {
      id: 'rock',
      title: 'Radio Paradise Rock Mix',
      description: 'A focused live mix of rock and alternative music.',
      genre: 'Rock',
      streamUrl: 'https://stream.radioparadise.com/rock-192',
      bitRate: 192,
    },
    {
      id: 'global',
      title: 'Radio Paradise Global Mix',
      description: 'A live mix of global music and discoveries.',
      genre: 'World',
      streamUrl: 'https://stream.radioparadise.com/global-192',
      bitRate: 192,
    },
  ],
});
