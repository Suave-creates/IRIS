import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

/**
 * Shared React Query client tuned for snappy perceived latency:
 * cached data shows instantly while a background refetch runs, and we never
 * retry client errors (4xx) — only transient network/5xx failures.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
