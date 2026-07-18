'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AudioProvider } from '@/components/player/AudioProvider';
import { useState, type ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              if (
                error instanceof DOMException &&
                error.name === 'AbortError'
              ) {
                return false;
              }

              const isTransientProviderError =
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                ['network', 'timeout', 'upstream'].includes(
                  String(error.code)
                );

              return (
                failureCount < 1 &&
                (error instanceof TypeError || isTransientProviderError)
              );
            },
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AudioProvider>
        {children}
      </AudioProvider>
    </QueryClientProvider>
  );
}
