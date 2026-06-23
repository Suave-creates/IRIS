import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { mailApi, type MailQuery } from './api';

const mailKey = {
  stats: ['mail', 'stats'] as const,
  items: (q: MailQuery) => ['mail', 'items', q.category ?? 'all', q.q ?? ''] as const,
};

/**
 * Already-indexed mail items, filtered server-side by category + keyword.
 * `keepPreviousData` holds the prior list while a new filter resolves, so
 * the list never flashes empty when you switch chips or type a keyword.
 */
export function useMailItems(category?: string, q?: string) {
  const query: MailQuery = { category, q };
  return useQuery({
    queryKey: mailKey.items(query),
    queryFn: () => mailApi.items(query),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** Index counts + per-category breakdown that powers the stats strip and chips. */
export function useMailStats() {
  return useQuery({
    queryKey: mailKey.stats,
    queryFn: () => mailApi.stats(),
    staleTime: 60_000,
  });
}
