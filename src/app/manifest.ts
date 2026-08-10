import type { MetadataRoute } from 'next';

/**
 * The installed-app description.
 *
 * `standalone` rather than `fullscreen`: this is a player, and a player that
 * hides the system clock and battery is the wrong trade for a thing people
 * leave running. The theme colour matches the header the app actually paints,
 * so the OS title bar does not sit against a strip of a different blue.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Marea — Creative Commons music',
    short_name: 'Marea',
    description:
      'Browse and play verified Creative Commons music from Jamendo, ccMixter and the Internet Archive, alongside Apple’s published charts as 30-second previews.',
    start_url: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#fbfcfe',
    theme_color: '#0d6fa8',
    categories: ['music', 'entertainment'],
    icons: [
      { src: '/icons/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // A separate maskable drawing rather than the same file declared twice:
      // a launcher that crops `any` artwork to a circle would clip the play
      // mark, and one that pads a `maskable` icon it was handed as `any`
      // leaves it floating in a box.
      { src: '/icons/maskable-512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Search', url: '/?view=search' },
      { name: 'Favorites', url: '/?view=favorites' },
      { name: 'Trending', url: '/?view=trending' },
    ],
  };
}
