import type { NextConfig } from 'next';
import path from 'node:path';
import { ARTWORK_REMOTE_PATTERNS } from './src/lib/artworkHosts';

const isDev = process.env.NODE_ENV === 'development';

// Keep the policy static so the app can retain Next's prerendering. Production
// deliberately omits unsafe-eval; development needs it for React/Next HMR.
// External artwork and radio streams are intentionally scheme-allowlisted here
// because their hosts are provider-controlled and change over time.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (isDev ? " 'unsafe-eval'" : ''),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: file: https:",
  "font-src 'self' data:",
  "media-src 'self' marea-media: blob: data: file: http: https:",
  "connect-src 'self' marea-media: https: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  // Playwright and local mobile-device testing commonly use the loopback IP
  // instead of localhost. Next 16 blocks dev resources from that origin unless
  // it is explicitly allowed.
  allowedDevOrigins: ['127.0.0.1'],
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
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
