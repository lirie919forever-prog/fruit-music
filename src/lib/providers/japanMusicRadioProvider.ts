import { createStaticRadioProvider } from './staticRadioProvider';

/**
 * Curated, public Japanese-music streams that are independently operated and
 * browser-playable. These sit alongside the dynamic Radio Browser index so a
 * listener still has direct stations when the index is slow or unavailable.
 */
export const japanMusicRadioProvider = createStaticRadioProvider({
  name: 'Japan Music Radio',
  idPrefix: 'japanradio',
  artist: 'Japan Music Radio',
  origin: 'https://j1fm.tokyo/',
  coverKey: 'japan-music-radio',
  stations: [
    {
      id: 'j1-hits',
      title: 'J1 HITS',
      artist: 'J1 HITS',
      description: 'Continuous Japanese hit music from J1 FM Tokyo.',
      genre: 'J-Pop',
      streamUrl: 'https://jenny.torontocast.com:2000/stream/J1HITS',
      bitRate: 128,
      sourceUrl: 'https://j1fm.tokyo/',
    },
    {
      id: 'japan-city-pop',
      title: 'Japan City Pop',
      artist: 'BOX Japan City Pop',
      description: 'A continuous city-pop station focused on Japanese classics and rediscoveries.',
      genre: 'City Pop / J-Pop',
      streamUrl: 'https://play.streamafrica.net/japancitypop',
      bitRate: 128,
      sourceUrl: 'https://boxradio.net/',
    },
    {
      id: 'radio',
      title: 'R/a/dio',
      artist: 'R/a/dio',
      description: 'Japanese pop, anime, and adjacent music in a continuous live stream.',
      genre: 'J-Pop / Anime',
      streamUrl: 'https://relay0.r-a-d.io/main.mp3',
      bitRate: 128,
      sourceUrl: 'https://r-a-d.io/',
    },
    {
      id: 'gensokyo',
      title: 'Gensokyo Radio',
      artist: 'Gensokyo Radio',
      description: 'Continuous Japanese doujin and game music programming.',
      genre: 'Japanese / Anime',
      streamUrl: 'https://stream.gensokyoradio.net/3',
      bitRate: 256,
      sourceUrl: 'https://gensokyoradio.net/',
    },
  ],
});
