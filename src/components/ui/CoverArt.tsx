'use client';

import { useEffect, useRef, useState } from 'react';
import Image, { type ImageProps } from 'next/image';
import { safeCoverArt } from '@/lib/coverArt';
import { useToast } from './Toast';

const FALLBACK = '/placeholder-album.svg';

/**
 * These sources are already safe to serve as-is. Remote URLs reach this point
 * only after `safeCoverArt` has checked the shared host allowlist.
 */
export function shouldServeArtworkDirectly(src: string): boolean {
  return src.startsWith('https://') || src.startsWith('data:') || src === FALLBACK;
}

function retrySource(src: string): string {
  try {
    const url = new URL(src, 'http://localhost');
    url.searchParams.set('marea_retry', '1');
    return src.startsWith('/') ? `${url.pathname}${url.search}${url.hash}` : url.toString();
  } catch {
    return src;
  }
}

export function CoverArt({
  src,
  alt,
  onError,
  sizes = '(max-width: 640px) 50vw, 200px',
  loading,
  preload,
  priority,
  ...props
}: Omit<ImageProps, 'src' | 'alt'> & { src?: string; alt: string }) {
  const safeSrc = safeCoverArt(src);
  const { push } = useToast();
  const [attempt, setAttempt] = useState({ source: safeSrc, count: 0 });
  const notifiedSourceRef = useRef<string | null>(null);
  // A tile can be reused while a virtualized list changes its song. Treating a
  // new source as a fresh image prevents a prior fallback from sticking to it.
  const count = attempt.source === safeSrc ? attempt.count : 0;
  const displaySrc = count === 0 ? safeSrc : count === 1 ? retrySource(safeSrc) : FALLBACK;

  useEffect(() => {
    if (attempt.source !== safeSrc || attempt.count < 2 || safeSrc === FALLBACK || safeSrc.startsWith('data:')) return;
    if (notifiedSourceRef.current === safeSrc) return;
    notifiedSourceRef.current = safeSrc;
    push('Artwork is unavailable, so Marea is using a fallback cover.', 'info');
  }, [attempt.count, attempt.source, push, safeSrc]);

  // Next 16 deprecated `priority`. Keep accepting it from callers while
  // forwarding the supported equivalent, and never combine preload + loading.
  const shouldPreload = preload ?? priority ?? loading === 'eager';
  return (
    <Image
      {...props}
      src={displaySrc}
      alt={alt}
      width={200}
      height={200}
      sizes={sizes}
      {...(shouldPreload ? { preload: true } : { loading })}
      unoptimized={shouldServeArtworkDirectly(displaySrc)}
      onError={(event) => {
        onError?.(event);
        if (event.defaultPrevented) return;
        if (safeSrc === FALLBACK || safeSrc.startsWith('data:')) return;
        // A page of Apple artwork asks for thirty-odd covers at once and one of
        // them occasionally fails under that burst. Falling straight back to
        // the placeholder pins a real cover to a grey square for the rest of
        // the session, so each image is allowed one retry first. The query
        // parameter is what makes it a fresh request: without it the browser
        // serves the cached failure straight back.
        // React owns the source transition. Mutating the image element leaves
        // Next Image's generated srcset pointing at the failed remote artwork.
        setAttempt((current) => {
          const nextCount = Math.min(2, (current.source === safeSrc ? current.count : 0) + 1);
          return { source: safeSrc, count: nextCount };
        });
      }}
    />
  );
}
