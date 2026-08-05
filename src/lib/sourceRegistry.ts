import type { MusicProviderName } from '@/types/music';

export type SourceCapability = 'full' | 'match' | 'live' | 'preview' | 'metadata';
export type SourceIntegration = 'active' | 'optional' | 'metadata-only';
export type SourceSetup = 'jamendo' | 'lx';
export type SourceReadiness = 'ready' | 'setup-required' | 'disabled' | 'metadata-only';

export interface SourceHealthSnapshot {
  name: string;
  readiness: SourceReadiness;
  detail: string;
}

export interface MusicSourceDefinition {
  name: string;
  description: string;
  homepage?: string;
  capabilities: readonly SourceCapability[];
  integration: SourceIntegration;
  setup?: SourceSetup;
  note: string;
  searchable?: boolean;
}

/** Keep source names consistent across Search, New, and the source directory. */
export const MUSIC_SOURCE_REGISTRY: readonly MusicSourceDefinition[] = [
  {
    name: 'Audius',
    description: 'Creator-published tracks and remixes with direct streaming.',
    homepage: 'https://audius.co/',
    capabilities: ['full'],
    integration: 'active',
    note: 'Full tracks',
    searchable: true,
  },
  {
    name: 'Wikimedia Commons',
    description: 'Open media files with per-record license and attribution data.',
    homepage: 'https://commons.wikimedia.org/wiki/Category:Audio_files',
    capabilities: ['full'],
    integration: 'active',
    note: 'Full tracks, open media',
    searchable: true,
  },
  {
    name: 'Jamendo',
    description: 'Independent music with licensing and attribution metadata.',
    homepage: 'https://www.jamendo.com/',
    capabilities: ['full'],
    integration: 'active',
    setup: 'jamendo',
    note: 'Full tracks, licensed catalog; client ID may be required',
    searchable: true,
  },
  {
    name: 'ccMixter',
    description: 'Community remixes and samples with Creative Commons terms.',
    homepage: 'https://ccmixter.org/',
    capabilities: ['full'],
    integration: 'active',
    note: 'Full tracks, remix catalog',
    searchable: true,
  },
  {
    name: 'Archive',
    description: 'Long-form public recordings and historical music collections.',
    homepage: 'https://archive.org/details/audio',
    capabilities: ['full'],
    integration: 'active',
    note: 'Full tracks, collection dependent',
    searchable: true,
  },
  {
    name: 'Openverse',
    description: 'Creative Commons discovery across open media catalogs.',
    homepage: 'https://openverse.org/',
    capabilities: ['full'],
    integration: 'active',
    note: 'Full tracks, open licenses',
    searchable: true,
  },
  {
    name: 'SomaFM',
    description: 'Curated independent internet radio channels, live right now.',
    homepage: 'https://somafm.com/',
    capabilities: ['live'],
    integration: 'active',
    note: 'Live radio',
    searchable: true,
  },
  {
    name: 'NTS Radio',
    description: 'Two live global music channels with the current broadcast schedule.',
    homepage: 'https://www.nts.live/',
    capabilities: ['live'],
    integration: 'active',
    note: 'Official live radio',
    searchable: true,
  },
  {
    name: 'Radio Paradise',
    description: 'Commercial-free, listener-supported music channels with official 192 kbps streams.',
    homepage: 'https://radioparadise.com/',
    capabilities: ['live'],
    integration: 'active',
    note: 'Official live radio, 192 kbps',
    searchable: true,
  },
  {
    name: 'KEXP',
    description: 'Seattle independent music radio with an official 128 kbps live stream.',
    homepage: 'https://www.kexp.org/listen/',
    capabilities: ['live'],
    integration: 'active',
    note: 'Official live radio, 128 kbps',
    searchable: true,
  },
  {
    name: 'FIP',
    description: 'French public radio’s eclectic, rock, and jazz music channels.',
    homepage: 'https://www.radiofrance.fr/fip',
    capabilities: ['live'],
    integration: 'active',
    note: 'Official live radio, 128 kbps',
    searchable: true,
  },
  {
    name: 'The Current',
    description: 'Minnesota Public Radio music discovery with an official 128 kbps live stream.',
    homepage: 'https://www.thecurrent.org/listen/',
    capabilities: ['live'],
    integration: 'active',
    note: 'Official live radio, 128 kbps',
    searchable: true,
  },
  {
    name: 'Radio Browser',
    description: 'A worldwide index of public internet radio stations.',
    homepage: 'https://www.radio-browser.info/',
    capabilities: ['live'],
    integration: 'active',
    note: 'Live radio, worldwide index',
    searchable: true,
  },
  {
    name: 'Local file',
    description: 'Audio imported from this device and kept in the local library.',
    capabilities: ['full'],
    integration: 'active',
    note: 'Imported files; playback depends on Chromium codec support',
  },
  {
    name: 'Apple Preview',
    description: 'Official Apple catalog metadata, charts, releases, and preview clips.',
    homepage: 'https://music.apple.com/us/new',
    capabilities: ['preview'],
    integration: 'active',
    note: 'Official previews; clips can be short',
    searchable: true,
  },
  {
    name: 'Deezer Preview',
    description: 'Mainstream discovery metadata and published preview clips.',
    homepage: 'https://www.deezer.com/',
    capabilities: ['preview'],
    integration: 'active',
    note: 'Official previews; clips can be short',
    searchable: true,
  },
  {
    name: 'Kuwo',
    description: 'Mainstream catalog matching used to find a verified playable recording when web playback is allowed.',
    homepage: 'https://www.kuwo.cn/',
    capabilities: ['match'],
    integration: 'active',
    note: 'Full-track matching; mobile-only items are skipped',
    searchable: true,
  },
  {
    name: 'LX Music',
    description: 'Optional operator-configured catalog adapter for additional discovery.',
    homepage: 'https://github.com/lyswhut/lx-music-desktop',
    capabilities: ['match'],
    integration: 'optional',
    setup: 'lx',
    note: 'Optional; disabled unless explicitly configured',
    searchable: true,
  },
  {
    name: 'MusicBrainz',
    description: 'Open artist, release, recording, and work metadata.',
    homepage: 'https://musicbrainz.org/',
    capabilities: ['metadata'],
    integration: 'metadata-only',
    note: 'Metadata only; no audio playback adapter',
  },
  {
    name: 'Open Opus',
    description: 'Open classical music metadata and work-level discovery.',
    homepage: 'https://openopus.org/',
    capabilities: ['metadata'],
    integration: 'metadata-only',
    note: 'Metadata only; no audio playback adapter',
  },
  {
    name: 'Tunetank',
    description: 'Royalty-free music and sound effects catalog for licensed use cases.',
    homepage: 'https://tunetank.com/',
    capabilities: ['metadata'],
    integration: 'metadata-only',
    note: 'Catalog reference only; licensed playback adapter is not connected',
  },
] as const;

export function getSearchSourceNames(lxEnabled: boolean): string[] {
  return MUSIC_SOURCE_REGISTRY.filter(
    (source) => source.searchable && (source.integration !== 'optional' || lxEnabled),
  ).map((source) => source.name);
}

export function getMusicSourceDefinition(name: string): MusicSourceDefinition | undefined {
  return MUSIC_SOURCE_REGISTRY.find((source) => source.name === name);
}

export function sourceHasCapability(name: string, capability: SourceCapability): boolean {
  return getMusicSourceDefinition(name)?.capabilities.includes(capability) ?? false;
}

export function isPreviewSource(name: string): boolean {
  return sourceHasCapability(name, 'preview');
}

export function isResolverSource(name: string): boolean {
  return sourceHasCapability(name, 'match');
}

export function isRuntimeProviderName(name: string): name is MusicProviderName {
  return MUSIC_SOURCE_REGISTRY.some((source) => source.name === name && source.integration !== 'metadata-only');
}
