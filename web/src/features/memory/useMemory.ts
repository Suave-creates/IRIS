import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MemoryOverview } from '@iris/shared';
import { memoryApi } from './api';

const overviewKey = ['memory', 'overview'] as const;

/** Memory counts, recently learned list, and knowledge graph. Cached for snappy navigation. */
export function useMemoryOverview() {
  return useQuery({ queryKey: overviewKey, queryFn: () => memoryApi.overview() });
}

/**
 * Forget a memory. Optimistically removes the row from the cached "recently learned"
 * list (and decrements the matching count) so the UI feels instant, then reconciles
 * with the server on settle.
 */
export function useForgetMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => memoryApi.forget(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: overviewKey });
      const prev = qc.getQueryData<MemoryOverview>(overviewKey);
      if (prev) {
        const removed = prev.recent.find((m) => m.id === id);
        const counts = { ...prev.counts };
        if (removed) {
          if (removed.scope === 'short') counts.shortTerm = Math.max(0, counts.shortTerm - 1);
          else counts.longTerm = Math.max(0, counts.longTerm - 1);
          if (removed.type === 'preference') counts.preferences = Math.max(0, counts.preferences - 1);
        }
        qc.setQueryData<MemoryOverview>(overviewKey, {
          ...prev,
          counts,
          recent: prev.recent.filter((m) => m.id !== id),
        });
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(overviewKey, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: overviewKey }),
  });
}
