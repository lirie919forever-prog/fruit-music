'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AudioProvider } from '@/components/player/AudioProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { MusicCatalogProvider } from '@/lib/musicCatalog';
import { useState, type ReactNode } from 'react';
import { MotionConfig } from 'motion/react';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              if (error instanceof DOMException && error.name === 'AbortError') {
                return false;
              }

              const isTransientProviderError =
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                ['network', 'timeout', 'upstream'].includes(String(error.code));

              return failureCount < 1 && (error instanceof TypeError || isTransientProviderError);
            },
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <MusicCatalogProvider catalog={api}>
          <ToastProvider>
            <AudioProvider>{children}</AudioProvider>
          </ToastProvider>
        </MusicCatalogProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}
