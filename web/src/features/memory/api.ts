import type { MemoryOverview } from '@iris/shared';
import { api } from '@/lib/api';

export const memoryApi = {
  /** Counts + recently learned memories + knowledge graph for the current tenant. */
  overview: () => api.get<MemoryOverview>('/memory/overview'),
  /** Forget (permanently delete) a single memory by id. */
  forget: (id: string) => api.delete<{ ok: true }>(`/memory/${id}`),
};
