/**
 * The one artwork allowlist.
 *
 * This list previously existed three times — the hosts in `coverArt.ts`, the
 * `APPROVED_HOSTS` set inside the `/api/images` proxy, and a second, subtly
 * different URL guard in `api.normalizeCoverArt`. Three chances for a provider
 * to be added to one and forgotten in the others, and the drift was already
 * visible: `api.vkeys.cn` sat in two of them while the feature that produces
 * those URLs ships disabled.
 *
 * Consumed by `next.config.ts` for `images.remotePatterns` and by the client
 * guard, so the browser and the optimizer can never disagree about what is
 * allowed.
 */
export interface ArtworkPattern {
  protocol: 'https';
  hostname: string;
  pathname: string;
}

/**
 * `api.vkeys.cn` only ever appears in artwork produced by the LX Music path,
 * which the README describes as opt-in and disabled by default — yet it sat
 * unconditionally in both copies of the old allowlist, so every deployment
 * allowed it whether or not LX was on. It is now gated on the same flag as the
 * feature that produces it, so the code and the README say the same thing.
 */
const LX_ENABLED = process.env.NEXT_PUBLIC_LX_ENABLED === 'true';

export const ARTWORK_REMOTE_PATTERNS: ArtworkPattern[] = [
  { protocol: 'https', hostname: 'usercontent.jamendo.com', pathname: '/**' },
  { protocol: 'https', hostname: 'ccmixter.org', pathname: '/**' },
  { protocol: 'https', hostname: 'www.ccmixter.org', pathname: '/**' },
  { protocol: 'https', hostname: 'is1-ssl.mzstatic.com', pathname: '/**' },
  { protocol: 'https', hostname: 'cdn-images.dzcdn.net', pathname: '/**' },
  { protocol: 'https', hostname: '**.figment.io', pathname: '/**' },
  { protocol: 'https', hostname: '**.staked.cloud', pathname: '/**' },
  { protocol: 'https', hostname: 'v.monophonic.digital', pathname: '/**' },
  { protocol: 'https', hostname: '**.theblueprint.xyz', pathname: '/**' },
  { protocol: 'https', hostname: '**.open-audio-validator.com', pathname: '/**' },
  { protocol: 'https', hostname: '**.mainnet.audiusindex.org', pathname: '/**' },
  { protocol: 'https', hostname: '**.altego.net', pathname: '/**' },
  { protocol: 'https', hostname: '**.shakespearetech.com', pathname: '/**' },
  { protocol: 'https', hostname: 'validator.stuffisup.com', pathname: '/**' },
  ...(LX_ENABLED ? [{ protocol: 'https' as const, hostname: 'api.vkeys.cn', pathname: '/**' }] : []),
];

const ARTWORK_HOSTS = new Set(ARTWORK_REMOTE_PATTERNS.map((pattern) => pattern.hostname));

/** True for a URL the image optimizer will accept, so the client can agree with it. */
export function isAllowedArtworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    ARTWORK_HOSTS.has(host) ||
    /^(?:audius-(?:content|creator|discovery)-\d+|audius-figment-1-validator-\d+)\.figment\.io$/.test(host) ||
    /^audius-\d+\.staked\.cloud$/.test(host) ||
    /^audius-[a-z0-9-]+\.theblueprint\.xyz$/.test(host) ||
    /^(?:val\d+|validator)\.open-audio-validator\.com$/.test(host) ||
    /^cn\d+\.mainnet\.audiusindex\.org$/.test(host) ||
    /^audius-discovery-\d+\.altego\.net$/.test(host) ||
    /^cn\d+\.shakespearetech\.com$/.test(host) ||
    host === 'validator.stuffisup.com'
  );
}
