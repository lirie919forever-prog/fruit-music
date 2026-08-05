import { describe, expect, it } from 'vitest';
import {
  getSearchSourceNames,
  isPreviewSource,
  isResolverSource,
  MUSIC_SOURCE_REGISTRY,
  sourceHasCapability,
} from './sourceRegistry';
import { MUSIC_PROVIDER_ADAPTERS } from '@/lib/providers';

describe('music source registry', () => {
  it('keeps resolver matches separate from direct full-track catalogs', () => {
    const kuwo = MUSIC_SOURCE_REGISTRY.find((source) => source.name === 'Kuwo');
    const audius = MUSIC_SOURCE_REGISTRY.find((source) => source.name === 'Audius');

    expect(kuwo?.capabilities).toEqual(['match']);
    expect(audius?.capabilities).toContain('full');
  });

  it('only exposes optional LX search when it is enabled', () => {
    expect(getSearchSourceNames(false)).not.toContain('LX Music');
    expect(getSearchSourceNames(true)).toContain('LX Music');
  });

  it('marks adapters that need server configuration without changing their capability', () => {
    expect(MUSIC_SOURCE_REGISTRY.find((source) => source.name === 'Jamendo')?.setup).toBe('jamendo');
    expect(MUSIC_SOURCE_REGISTRY.find((source) => source.name === 'LX Music')?.setup).toBe('lx');
  });

  it('keeps playback capability checks registry-driven', () => {
    expect(isResolverSource('Kuwo')).toBe(true);
    expect(isResolverSource('LX Music')).toBe(true);
    expect(isResolverSource('Audius')).toBe(false);
    expect(isPreviewSource('Apple Preview')).toBe(true);
    expect(isPreviewSource('Deezer Preview')).toBe(true);
    expect(sourceHasCapability('Local file', 'full')).toBe(true);
  });

  it('keeps every runtime source backed by exactly one adapter', () => {
    const runtimeSources = MUSIC_SOURCE_REGISTRY.filter((source) => source.integration !== 'metadata-only').map(
      (source) => source.name,
    );
    const adapterNames = MUSIC_PROVIDER_ADAPTERS.map((registration) => registration.name);

    expect(new Set(adapterNames)).toEqual(new Set(runtimeSources));
    expect(adapterNames).toHaveLength(runtimeSources.length);
  });
});
