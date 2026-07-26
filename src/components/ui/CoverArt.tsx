'use client';

import Image, { type ImageProps } from 'next/image';
import { optimizedCoverArt } from '@/lib/coverArt';

const FALLBACK = '/placeholder-album.svg';

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
        event.currentTarget.onerror = null;
        event.currentTarget.src = FALLBACK;
      }}
    />
  );
}
