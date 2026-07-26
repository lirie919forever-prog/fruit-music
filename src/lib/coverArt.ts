import { isAllowedArtworkHost } from '@/lib/artworkHosts';

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character] ?? character);
}

/**
 * Narrows an arbitrary provider value to something safe to hand `next/image`.
 *
 * The host check matters as much as the protocol one: `remotePatterns` makes
 * the optimizer reject an unlisted host with a 400, which renders as a broken
 * tile. Filtering here means an unexpected host degrades to the placeholder
 * instead. The list is shared with the optimizer config precisely so the two
 * can never disagree.
 */
export function safeCoverArt(value: string | undefined, fallback = '/placeholder-album.svg'): string {
  if (!value) return fallback;
  if (value.startsWith('/') || value.startsWith('data:image/')) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && isAllowedArtworkHost(url.hostname) ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Stand-in artwork for the providers that ship none.
 *
 * Kept deliberately pale and low-saturation. These tiles are common enough in a
 * Creative Commons catalog that a grid can be half generated art, and at full
 * saturation they out-shout the real covers beside them — the placeholder ends
 * up being the loudest thing on the page. The hue still derives from the seed so
 * a release stays visually recognisable between visits.
 *
 * `hueOffset` is retained by callers to separate one provider's tiles from
 * another's; it now shifts a faint two-stop wash rather than a vivid gradient.
 */
export function createDeterministicCover(seed: string, hueOffset = 60): string {
  const normalizedSeed = seed.trim() || 'music';
  let hash = 0;
  for (const character of normalizedSeed) {
    hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  }

  const hue = hash % 360;
  const saturation = 14 + (hash % 10);
  const lightness = 88 + (hash % 5);
  const label = escapeXml(Array.from(normalizedSeed)[0]?.toUpperCase() || 'M');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="hsl(${hue},${saturation}%,${lightness}%)"/><stop offset="100%" stop-color="hsl(${(hue + hueOffset) % 360},${saturation}%,${Math.max(78, lightness - 6)}%)"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><text x="100" y="118" font-family="system-ui,sans-serif" font-size="68" font-weight="500" text-anchor="middle" fill="hsl(${hue},22%,42%)">${label}</text></svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
