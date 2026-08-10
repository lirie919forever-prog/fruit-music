'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface VirtualGridProps<T> {
  items: T[];
  /** Estimated height of one rendered row. TanStack corrects this after measurement. */
  estimateRowSize: number;
  /** Minimum width of a card before another column is introduced. */
  minColumnWidth: number;
  /** Horizontal space between cards. */
  columnGap?: number;
  overscan?: number;
  label: string;
  getItemKey?: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Responsive card-grid counterpart to VirtualList.
 *
 * Virtualizing individual cards would destroy the grid geometry. This primitive
 * virtualizes measured rows instead, recomputing the column count through a
 * ResizeObserver whenever the content pane changes width. It keeps responsive
 * catalog surfaces dense while bounding the number of mounted cards.
 */
export function VirtualGrid<T>({
  items,
  estimateRowSize,
  minColumnWidth,
  columnGap = 16,
  overscan = 4,
  label,
  getItemKey,
  renderItem,
  className = '',
  style,
}: VirtualGridProps<T>) {
  const scrollElementRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);

  useEffect(() => {
    const element = scrollElementRef.current;
    if (!element) return;

    const updateColumns = () => {
      const width = element.clientWidth;
      if (width <= 0) return;
      const next = Math.max(1, Math.floor((width + columnGap) / (minColumnWidth + columnGap)));
      setColumnCount((current) => (current === next ? current : next));
    };

    updateColumns();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateColumns);
    observer.observe(element);
    return () => observer.disconnect();
  }, [columnGap, minColumnWidth]);

  const rows = useMemo(() => {
    const next: T[][] = [];
    for (let index = 0; index < items.length; index += columnCount) {
      next.push(items.slice(index, index + columnCount));
    }
    return next;
  }, [columnCount, items]);
  const defaultHeight = Math.min(Math.max(rows.length * estimateRowSize, estimateRowSize), 640);
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
    count: rows.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => estimateRowSize,
    getItemKey: getItemKey
      ? (rowIndex) =>
          rows[rowIndex]
            ?.map((item, itemIndex) => String(getItemKey(item, rowIndex * columnCount + itemIndex)))
            .join('|') ?? rowIndex
      : undefined,
    overscan,
    useFlushSync: false,
  });
  const measuredRows = virtualizer.getVirtualItems();
  const virtualRows =
    measuredRows.length > 0
      ? measuredRows
      : rows.slice(0, Math.max(overscan * 2, 4)).map((_, index) => ({
          index,
          key: index,
          size: estimateRowSize,
          start: index * estimateRowSize,
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
        {virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          return (
            <div
              key={virtualRow.key}
              role="listitem"
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                left: 0,
                position: 'absolute',
                top: 0,
                transform: `translateY(${virtualRow.start}px)`,
                width: '100%',
              }}
            >
              <div
                className="grid"
                style={{
                  columnGap: `${columnGap}px`,
                  gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                }}
              >
                {row.map((item, itemIndex) => (
                  <div key={getItemKey?.(item, virtualRow.index * columnCount + itemIndex) ?? itemIndex}>
                    {renderItem(item, virtualRow.index * columnCount + itemIndex)}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
