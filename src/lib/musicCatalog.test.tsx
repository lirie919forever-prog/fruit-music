/** @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MusicCatalog } from './catalogTypes';
import { MusicCatalogProvider, useMusicCatalog } from './musicCatalog';

const injectedCatalog = { isServerConfigured: () => false } as MusicCatalog;

function Probe() {
  const catalog = useMusicCatalog();
  return <output>{catalog === injectedCatalog ? 'injected' : 'wrong catalog'}</output>;
}

describe('MusicCatalogProvider', () => {
  it('exposes the composition-root catalog to renderer consumers', () => {
    render(
      <MusicCatalogProvider catalog={injectedCatalog}>
        <Probe />
      </MusicCatalogProvider>,
    );

    expect(screen.getByText('injected')).toBeInTheDocument();
  });
});
