import { createStaticRadioProvider } from './staticRadioProvider';

const RADIO_FRANCE_ORIGIN = 'https://www.radiofrance.fr/';

export const radioFranceProvider = createStaticRadioProvider({
  name: 'Radio France',
  idPrefix: 'radiofrance',
  artist: 'Radio France',
  origin: RADIO_FRANCE_ORIGIN,
  coverKey: 'radio-france',
  stations: [
    {
      id: 'mouv',
      title: "Mouv'",
      description: 'French public radio for hip-hop, R&B, pop, and urban culture.',
      genre: 'Hip-hop / Pop',
      streamUrl: 'https://icecast.radiofrance.fr/mouv-midfi.mp3',
      bitRate: 128,
      sourceUrl: 'https://www.radiofrance.fr/mouv',
    },
    {
      id: 'france-inter',
      title: 'France Inter',
      description: 'French public radio with music, culture, news, and live programs.',
      genre: 'Music / Culture',
      streamUrl: 'https://icecast.radiofrance.fr/franceinter-midfi.mp3',
      bitRate: 128,
      sourceUrl: 'https://www.radiofrance.fr/franceinter',
    },
    {
      id: 'france-musique',
      title: 'France Musique',
      description: 'French public radio for classical music, jazz, and musical culture.',
      genre: 'Classical / Jazz',
      streamUrl: 'https://icecast.radiofrance.fr/francemusique-midfi.mp3',
      bitRate: 128,
      sourceUrl: 'https://www.radiofrance.fr/francemusique',
    },
  ],
});
