import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mailApi, type MailQuery } from './api';

const mailKey = {
  stats: ['mail', 'stats'] as const,
  items: (q: MailQuery) =>
    [
      'mail',
      'items',
      q.category ?? 'all',
      q.q ?? '',
      q.limit ?? 0,
      q.days ?? 0,
      q.from ?? '',
      q.to ?? '',
      q.taggedMe ? 1 : 0,
    ] as const,
};

/**
 * Already-indexed mail items, filtered server-side by category, keyword, a
 * last-N-days window, and/or "tagged me". `keepPreviousData` holds the prior
 * list while a new filter resolves, so the list never flashes empty.
 */
export function useMailItems(query: MailQuery = {}) {
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

/** Fetches recent Gmail and AI-triages it, then refreshes the list + stats. */
export function useSyncMail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => mailApi.sync(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mail'] });
    },
  });
}
