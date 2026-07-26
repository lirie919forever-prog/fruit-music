import type { NextConfig } from 'next';
import path from 'node:path';
import { ARTWORK_REMOTE_PATTERNS } from './src/lib/artworkHosts';

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    remotePatterns: ARTWORK_REMOTE_PATTERNS,
    // The optimizer follows an upstream redirect *without* re-checking
    // remotePatterns against the new location (see the `remotePatterns` note in
    // next/image's reference). That is the same hole the media proxy just had
    // closed, so it is shut here too: all three artwork hosts answer 200
    // directly — checked against each — and none needs a hop. If one ever
    // starts redirecting, the tile falls back to the placeholder rather than
    // fetching an unvalidated URL.
    maximumRedirects: 0,
    // Artwork is immutable at a given URL: Apple and Jamendo both encode the
    // size in the path, so a changed image is a changed URL.
    minimumCacheTTL: 86_400,
  },
};

export default nextConfig;
