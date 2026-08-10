// @vitest-environment happy-dom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { useNearViewport } from './useNearViewport';

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  readonly disconnect = vi.fn();
  readonly observe = vi.fn();

  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    MockIntersectionObserver.instances.push(this);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve = vi.fn();
}

function ViewportTarget({ enabled = true }: { enabled?: boolean }) {
  const targetRef = useRef<HTMLDivElement>(null);
  const isNearViewport = useNearViewport(targetRef, '320px 0px', enabled);
  return <div ref={targetRef} data-testid="viewport-target" data-near={String(isNearViewport)} />;
}

afterEach(() => {
  MockIntersectionObserver.instances = [];
  vi.unstubAllGlobals();
});

describe('useNearViewport', () => {
  it('activates only after the observed section approaches the viewport', () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

    render(<ViewportTarget />);

    const target = screen.getByTestId('viewport-target');
    const observer = MockIntersectionObserver.instances[0];
    expect(target).toHaveAttribute('data-near', 'false');
    expect(observer).toBeDefined();
    expect(observer.observe).toHaveBeenCalledWith(target);
    expect(observer.options).toEqual({ rootMargin: '320px 0px' });

    act(() => {
      observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], observer as never);
    });

    expect(target).toHaveAttribute('data-near', 'true');
    expect(observer.disconnect).toHaveBeenCalled();
  });

  it('activates after mount when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);

    render(<ViewportTarget />);

    expect(screen.getByTestId('viewport-target')).toHaveAttribute('data-near', 'true');
  });

  it('waits for an occupied layout before starting observation', () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

    const { rerender } = render(<ViewportTarget enabled={false} />);

    expect(MockIntersectionObserver.instances).toEqual([]);
    rerender(<ViewportTarget enabled />);

    expect(MockIntersectionObserver.instances).toHaveLength(1);
  });

  it('activates when a nested scroll skips past the observer target', () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

    render(<ViewportTarget />);

    const target = screen.getByTestId('viewport-target');
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect);

    act(() => {
      fireEvent.scroll(target);
    });

    expect(target).toHaveAttribute('data-near', 'true');
  });
});
