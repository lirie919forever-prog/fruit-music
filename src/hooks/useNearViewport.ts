'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * Marks a section ready once it is approaching the visible scroll area.
 * Keeping this separate from the fetching hooks lets lower discovery shelves
 * stay dormant until a listener is likely to reach them.
 */
export function useNearViewport<T extends Element>(
  ref: RefObject<T | null>,
  rootMargin = '480px 0px',
  enabled = true,
): boolean {
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    if (!enabled || isNearViewport) return;

    const target = ref.current;
    if (!target || typeof IntersectionObserver === 'undefined') {
      if (target) setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setIsNearViewport(true);
        observer.disconnect();
      },
      { rootMargin },
    );

    observer.observe(target);
    // A user can fling a nested scroll container past a tiny sentinel in one
    // frame. Capturing scroll events covers that path, while the observer
    // remains the inexpensive normal-case signal.
    const preloadDistance = Number.parseFloat(rootMargin) || 0;
    const activateAfterFastScroll = () => {
      if (target.getBoundingClientRect().top <= window.innerHeight + preloadDistance) {
        setIsNearViewport(true);
      }
    };
    window.addEventListener('scroll', activateAfterFastScroll, true);

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', activateAfterFastScroll, true);
    };
  }, [enabled, isNearViewport, ref, rootMargin]);

  return isNearViewport;
}
