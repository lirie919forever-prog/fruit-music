import {
  MUSIC_SOURCE_REGISTRY,
  type SourceHealthSnapshot,
  type SourceReadiness,
  type SourceSetup,
} from './sourceRegistry';

function validHttpsEndpoint(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash;
  } catch {
    return false;
  }
}

function setupReadiness(setup: SourceSetup): { readiness: SourceReadiness; detail: string } {
  if (setup === 'jamendo') {
    return process.env.JAMENDO_CLIENT_ID?.trim()
      ? { readiness: 'ready', detail: 'Server client ID configured' }
      : { readiness: 'setup-required', detail: 'Add JAMENDO_CLIENT_ID on the server' };
  }

  if (process.env.NEXT_PUBLIC_LX_ENABLED !== 'true') {
    return { readiness: 'disabled', detail: 'Disabled by configuration' };
  }

  const hasEndpoint = validHttpsEndpoint(process.env.LX_API_BASE) || validHttpsEndpoint(process.env.LX_RESOLVER_BASE);
  return hasEndpoint
    ? { readiness: 'ready', detail: 'Reviewed server endpoint configured' }
    : { readiness: 'setup-required', detail: 'Add a reviewed HTTPS LX endpoint' };
}

export function getSourceHealth(): SourceHealthSnapshot[] {
  return MUSIC_SOURCE_REGISTRY.map((source) => {
    if (source.integration === 'metadata-only') {
      return { name: source.name, readiness: 'metadata-only', detail: 'Catalog reference only' };
    }

    if (source.setup) {
      return { name: source.name, ...setupReadiness(source.setup) };
    }

    if (source.name === 'Local file') {
      return { name: source.name, readiness: 'ready', detail: 'Available for imported files' };
    }

    return { name: source.name, readiness: 'ready', detail: 'Configured adapter; runtime status is checked when used' };
  });
}
