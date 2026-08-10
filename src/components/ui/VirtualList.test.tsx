/** @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VirtualList } from './VirtualList';

describe('VirtualList', () => {
  it('keeps a large list bounded to the initial render window', () => {
    const items = Array.from({ length: 500 }, (_, index) => `track-${index}`);

    render(
      <VirtualList
        items={items}
        estimateSize={48}
        overscan={4}
        label="Test tracks"
        getItemKey={(item) => item}
        renderItem={(item) => <span>{item}</span>}
      />,
    );

    const list = screen.getByRole('list', { name: 'Test tracks' });
    expect(list.querySelectorAll('[role="listitem"]').length).toBeLessThanOrEqual(10);
    expect(screen.getByText('track-0')).toBeInTheDocument();
    expect(screen.queryByText('track-499')).not.toBeInTheDocument();
  });
});
