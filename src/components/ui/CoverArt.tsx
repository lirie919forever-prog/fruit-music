'use client';

import Image, { type ImageProps } from 'next/image';
import { safeCoverArt } from '@/lib/coverArt';

const FALLBACK = '/placeholder-album.svg';
/** Next's own optimizer endpoint, which now stands where `/api/images` did. */
const OPTIMIZER_PATH = '/_next/image';

export function isOptimizedArtwork(src: string): boolean {
  try {
    return new URL(src, 'http://localhost').pathname === OPTIMIZER_PATH;
  } catch {
    return false;
  }
}

export function CoverArt({ src, alt, onError, sizes = '(max-width: 640px) 50vw, 200px', loading, priority, ...props }: Omit<ImageProps, 'src' | 'alt'> & { src?: string; alt: string }) {
  const safeSrc = safeCoverArt(src);
  // The generated data-URI covers are already the exact bytes to display, and
  // the optimizer refuses a data: source anyway.
  const isGenerated = safeSrc.startsWith('data:');
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
      {...(isGenerated ? { unoptimized: true } : {})}
      onError={(event) => {
        onError?.(event);
        if (event.defaultPrevented) return;
        const image = event.currentTarget;
        // A page of Apple artwork asks for thirty-odd covers at once and one of
        // them occasionally fails under that burst. Falling straight back to
        // the placeholder pins a real cover to a grey square for the rest of
        // the session, so each image is allowed one retry first. The query
        // parameter is what makes it a fresh request: without it the browser
        // serves the cached failure straight back.
        //
        // Scoped to the optimizer specifically: the placeholder and the
        // generated data-URI covers are same-origin too, and appending
        // `&retry=1` to a path that carries no query string would only produce
        // a second 404.
        if (isOptimizedArtwork(image.src) && !image.dataset.retried) {
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
