'use client';

import Image, { type ImageProps } from 'next/image';
import { optimizedCoverArt } from '@/lib/coverArt';

const FALLBACK = '/placeholder-album.svg';
const PROXY_PATH = '/api/images';

export function isProxiedArtwork(src: string): boolean {
  try {
    return new URL(src, 'http://localhost').pathname === PROXY_PATH;
  } catch {
    return false;
  }
}

export function CoverArt({ src, alt, onError, sizes = '(max-width: 640px) 50vw, 200px', loading, priority, ...props }: Omit<ImageProps, 'src' | 'alt'> & { src?: string; alt: string }) {
  const safeSrc = optimizedCoverArt(src);
  // An eagerly requested cover is deliberately above the fold and is usually
  // the LCP element, so it is marked high priority. `priority` already implies
  // eager loading, and Next rejects being given both.
  const isPriority = priority ?? loading === 'eager';
  return (
    <Image
      {...props}
      src={safeSrc}
      alt={alt}
      width={200}
      height={200}
      sizes={sizes}
      {...(isPriority ? { priority: true } : { loading })}
      unoptimized
      onError={(event) => {
        onError?.(event);
        if (event.defaultPrevented) return;
        const image = event.currentTarget;
        // A page of Apple artwork requests thirty-odd covers at once, and the
        // proxy occasionally answers one of them with a 502 under that burst.
        // Falling straight back to the placeholder pins a real cover to a grey
        // square for the rest of the session, so each image is allowed one
        // retry first. The query parameter is what makes it a fresh request:
        // without it the browser serves the cached failure straight back.
        // Scoped to the proxy specifically: the placeholder and the generated
        // data-URI covers are same-origin too, and appending `&retry=1` to a
        // path that carries no query string would only produce a second 404.
        if (isProxiedArtwork(image.src) && !image.dataset.retried) {
          image.dataset.retried = '1';
          image.src = `${image.src}&retry=1`;
          return;
        }
        image.onerror = null;
        image.src = FALLBACK;
      }}
    />
  );
}
