const ARTWORK_HOSTS = new Set([
  'usercontent.jamendo.com',
  'ccmixter.org',
  'www.ccmixter.org',
  'api.vkeys.cn',
  'is1-ssl.mzstatic.com',
]);

export function optimizedCoverArt(value: string | undefined, fallback = '/placeholder-album.svg'): string {
  const safe = safeCoverArt(value, fallback);
  if (safe.startsWith('/') || safe.startsWith('data:image/')) return safe;
  try {
    const url = new URL(safe);
    if (!ARTWORK_HOSTS.has(url.hostname.toLowerCase())) return fallback;
    return `/api/images?url=${encodeURIComponent(url.toString())}`;
  } catch {
    return fallback;
  }
}
function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character] ?? character);
}


export function safeCoverArt(value: string | undefined, fallback = '/placeholder-album.svg'): string {
  if (!value) return fallback;
  if (value.startsWith('/') || value.startsWith('data:image/')) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

export function createDeterministicCover(seed: string, hueOffset = 60): string {
  const normalizedSeed = seed.trim() || 'music';
  let hash = 0;
  for (const character of normalizedSeed) {
    hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  }

  const hue = hash % 360;
  const saturation = 38 + (hash % 24);
  const lightness = 22 + (hash % 18);
  const label = escapeXml(Array.from(normalizedSeed)[0]?.toUpperCase() || 'M');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="hsl(${hue},${saturation}%,${lightness}%)"/><stop offset="100%" stop-color="hsl(${(hue + hueOffset) % 360},${saturation}%,${Math.min(78, lightness + 16)}%)"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><text x="100" y="118" font-family="system-ui,sans-serif" font-size="68" text-anchor="middle" fill="rgba(255,255,255,0.62)">${label}</text></svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
