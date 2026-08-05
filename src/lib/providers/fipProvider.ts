import { createStaticRadioProvider } from './staticRadioProvider';

const FIP_ORIGIN = 'https://www.radiofrance.fr/fip';

export const fipProvider = createStaticRadioProvider({
  name: 'FIP',
  idPrefix: 'fip',
  artist: 'FIP',
  origin: FIP_ORIGIN,
  coverKey: 'fip',
  stations: [
    {
      id: 'main',
      title: 'FIP',
      description: "France Musique's eclectic live music channel.",
      genre: 'Eclectic',
      streamUrl: 'https://icecast.radiofrance.fr/fip-midfi.mp3',
      bitRate: 128,
    },
    {
      id: 'rock',
      title: 'FIP Rock',
      description: 'A live channel for rock, indie, and alternative music.',
      genre: 'Rock',
      streamUrl: 'https://icecast.radiofrance.fr/fiprock-midfi.mp3',
      bitRate: 128,
    },
    {
      id: 'jazz',
      title: 'FIP Jazz',
      description: 'A live channel dedicated to jazz and adjacent styles.',
      genre: 'Jazz',
      streamUrl: 'https://icecast.radiofrance.fr/fipjazz-midfi.mp3',
      bitRate: 128,
    },
  ],
});
