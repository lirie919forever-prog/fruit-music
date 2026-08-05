'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';

export interface VirtualListProps<T> {
  items: T[];
  /** The stable row height used for the initial measurement and scroll range. */
  estimateSize: number;
  /** Keep a small render window around the viewport so fast wheel/touch scrolls stay filled. */
  overscan?: number;
  label: string;
  getItemKey?: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * A contained list primitive for high-cardinality music surfaces.
 *
 * The app owns the page shell and the player controls, so a virtualized list
 * gets its own scrollport. That keeps the browser from laying out thousands of
 * cards while preserving normal keyboard focus and an explicit list boundary.
 * Rows may grow slightly beyond the estimate; TanStack measures them after
 * mount and corrects the scroll range without forcing the whole page to render.
 */
export function VirtualList<T>({
  items,
  estimateSize,
  overscan = 8,
  label,
  getItemKey,
  renderItem,
  className = '',
  style,
}: VirtualListProps<T>) {
  const scrollElementRef = useRef<HTMLDivElement>(null);
  const defaultHeight = Math.min(Math.max(items.length * estimateSize, estimateSize), 560);
  const heightStyle = useMemo<CSSProperties>(
    () => ({
      height: `${defaultHeight}px`,
      contain: 'strict',
      ...style,
    }),
    [defaultHeight, style],
  );
  // TanStack Virtual intentionally returns a mutable controller; React
  // Compiler must not memoize the object it exposes as if it were immutable.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => estimateSize,
    getItemKey: getItemKey ? (index) => getItemKey(items[index], index) : undefined,
    overscan,
    useFlushSync: false,
  });
  const wasVisibleRef = useRef(false);

  useEffect(() => {
    const element = scrollElementRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    let frame: number | null = null;

    const scheduleResync = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (element.clientWidth === 0 || element.clientHeight === 0) return;
        virtualizer.scrollToOffset(element.scrollTop);
        element.dispatchEvent(new Event('scroll'));
      });
    };

    const syncVisibility = () => {
      const visible = element.clientWidth > 0 && element.clientHeight > 0;
      if (visible && !wasVisibleRef.current) {
        // A list mounted under a responsive `display: none` parent can retain
        // TanStack's previous offset even though the real scrollport is at 0.
        // Re-syncing on the visibility edge keeps the first rows reachable.
        scheduleResync();
      }
      wasVisibleRef.current = visible;
    };

    syncVisibility();
    const observer = new ResizeObserver(syncVisibility);
    observer.observe(element);
    const handleWindowResize = () => {
      syncVisibility();
      if (element.clientWidth > 0 && element.clientHeight > 0) scheduleResync();
    };
    window.addEventListener('resize', handleWindowResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [virtualizer]);

  const measuredItems = virtualizer.getVirtualItems();
  const virtualItems =
    measuredItems.length > 0
      ? measuredItems
      : items.slice(0, Math.max(overscan * 2, 10)).map((_, index) => ({
          index,
          key: getItemKey ? getItemKey(items[index], index) : index,
          size: estimateSize,
          start: index * estimateSize,
        }));

  return (
    <div
      ref={scrollElementRef}
      role="list"
      aria-label={label}
      className={`overflow-y-auto overscroll-contain ${className}`}
      style={heightStyle}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: 'relative',
          width: '100%',
        }}
      >
        {virtualItems.map((virtualItem) => {
          const item = items[virtualItem.index];
          if (item === undefined) return null;
          return (
            <div
              key={virtualItem.key}
              role="listitem"
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              style={{
                left: 0,
                position: 'absolute',
                top: 0,
                transform: `translateY(${virtualItem.start}px)`,
                width: '100%',
              }}
            >
              {renderItem(item, virtualItem.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
