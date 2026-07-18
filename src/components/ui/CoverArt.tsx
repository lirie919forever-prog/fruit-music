'use client';

import type { ImgHTMLAttributes } from 'react';

const FALLBACK = '/placeholder-album.svg';

export function CoverArt({ src, alt, onError, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      {...props}
      src={src || FALLBACK}
      alt={alt}
      onError={(event) => {
        onError?.(event);
        if (event.defaultPrevented) return;
        event.currentTarget.onerror = null;
        event.currentTarget.src = FALLBACK;
      }}
    />
  );
}
