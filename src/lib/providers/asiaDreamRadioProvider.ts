import { createStaticRadioProvider } from './staticRadioProvider';

const ASIA_DREAM_RADIO_ORIGIN = 'https://asiadreamradio.com/';

/**
 * Asia Dream Radio publishes dedicated Japanese-music stations with stable,
 * browser-playable MP3 endpoints. Keeping these first-class means the Japan
 * radio lane does not depend entirely on an aggregator search response.
 */
export const asiaDreamRadioProvider = createStaticRadioProvider({
  name: 'Asia Dream Radio',
  idPrefix: 'asiadream',
  artist: 'Asia Dream Radio',
  origin: ASIA_DREAM_RADIO_ORIGIN,
  coverKey: 'asia-dream-radio',
  stations: [
    {
      id: 'jpop-sakura',
      title: 'J-Pop Sakura',
      description: 'Current and classic Japanese pop from Asia Dream Radio.',
      genre: 'J-Pop',
      streamUrl: 'https://quincy.torontocast.com:2070/stream.mp3',
      bitRate: 128,
      sourceUrl: 'https://asiadreamradio.com/genres/j-pop/',
    },
    {
      id: 'jpop-powerplay',
      title: 'J-Pop Powerplay',
      description: 'A continuous Japanese pop station focused on current hits.',
      genre: 'J-Pop',
      streamUrl: 'https://kathy.torontocast.com:3560/stream/1/',
      bitRate: 128,
      sourceUrl: 'https://asiadreamradio.com/genres/j-pop/',
    },
    {
      id: 'kawaii',
      title: 'J-Pop Kawaii',
      description: 'Japanese idol pop and brighter contemporary J-pop.',
      genre: 'J-Pop / Idol',
      streamUrl: 'https://kathy.torontocast.com:3060/stream/1/',
      bitRate: 128,
      sourceUrl: 'https://asiadreamradio.com/genres/j-pop/',
    },
  ],
});
