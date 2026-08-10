'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { MusicCatalog } from './catalogTypes';

const MusicCatalogContext = createContext<MusicCatalog | null>(null);

export function MusicCatalogProvider({ catalog, children }: { catalog: MusicCatalog; children: ReactNode }) {
  return <MusicCatalogContext.Provider value={catalog}>{children}</MusicCatalogContext.Provider>;
}

export function useMusicCatalog(): MusicCatalog {
  const catalog = useContext(MusicCatalogContext);
  if (!catalog) {
    throw new Error('useMusicCatalog must be used within <MusicCatalogProvider>.');
  }
  return catalog;
}
