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

const PROVIDER_TIMEOUT_MS = 9_000;

function composeSignals(
  external: AbortSignal | undefined,
  timeout: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  if (!external) return { signal: timeout, cleanup: () => {} };
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort(external.reason);
  const abortFromTimeout = () => controller.abort(timeout.reason);
  if (external.aborted) abortFromExternal();
  else external.addEventListener('abort', abortFromExternal, { once: true });
  if (timeout.aborted) abortFromTimeout();
  else timeout.addEventListener('abort', abortFromTimeout, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      external.removeEventListener('abort', abortFromExternal);
      timeout.removeEventListener('abort', abortFromTimeout);
    },
  };
}

export function externalAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}

export async function providerFetch<T>(
  provider: string,
  operation: string,
  path: string,
  params: Record<string, string> = {},
  externalSignal?: AbortSignal,
): Promise<T> {
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const url = new URL(path, origin);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(new DOMException('Timed out', 'TimeoutError')),
    PROVIDER_TIMEOUT_MS,
  );
  const request = composeSignals(externalSignal, timeoutController.signal);

  try {
    const response = await fetch(url.toString(), { signal: request.signal });
    if (!response.ok) {
      const code: ProviderErrorCode =
        response.status === 503 ? 'not_configured' : response.status === 504 ? 'timeout' : 'upstream';
      throw new ProviderError(provider, operation, code, response.status);
    }
    try {
      return (await response.json()) as T;
    } catch {
      if (externalSignal?.aborted) throw externalAbortError(externalSignal);
      if (timeoutController.signal.aborted) throw new ProviderError(provider, operation, 'timeout', 504);
      throw new ProviderError(provider, operation, 'invalid_response', response.status);
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (externalSignal?.aborted) throw error;
    if (timeoutController.signal.aborted) throw new ProviderError(provider, operation, 'timeout', 504);
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ProviderError(
      provider,
      operation,
      'network',
      undefined,
      error instanceof Error ? error.message : undefined,
    );
  } finally {
    clearTimeout(timeout);
    request.cleanup();
  }
}

export function providerErrorMessage(error: unknown): string {
  if (!(error instanceof ProviderError)) return 'Music could not be loaded. Please try again.';
  if (error.code === 'not_configured') return `${error.provider} is not configured on this server.`;
  if (error.code === 'timeout') return `${error.provider} took too long to respond.`;
  return `${error.provider} is currently unavailable.`;
}
