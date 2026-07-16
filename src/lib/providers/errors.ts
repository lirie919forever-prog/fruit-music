export type ProviderErrorCode = 'not_configured' | 'timeout' | 'upstream' | 'invalid_response' | 'network';

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly operation: string,
    public readonly code: ProviderErrorCode,
    public readonly status?: number,
    message?: string,
  ) {
    super(message ?? `${provider} ${operation} failed`);
    this.name = 'ProviderError';
  }
}

export async function providerFetch<T>(
  provider: string,
  operation: string,
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  let response: Response;
  try {
    response = await fetch(url.toString());
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ProviderError(provider, operation, 'network', undefined, error instanceof Error ? error.message : undefined);
  }

  if (!response.ok) {
    const code: ProviderErrorCode = response.status === 503 ? 'not_configured' : response.status === 504 ? 'timeout' : 'upstream';
    throw new ProviderError(provider, operation, code, response.status);
  }

  try {
    return await response.json() as T;
  } catch {
    throw new ProviderError(provider, operation, 'invalid_response', response.status);
  }
}

export function providerErrorMessage(error: unknown): string {
  if (!(error instanceof ProviderError)) return 'Music could not be loaded. Please try again.';
  if (error.code === 'not_configured') return `${error.provider} is not configured on this server.`;
  if (error.code === 'timeout') return `${error.provider} took too long to respond.`;
  return `${error.provider} is currently unavailable.`;
}
