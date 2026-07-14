import type { PlannerBlock, PlannerBlockInput, UpdatePlannerBlockInput } from '@iris/shared';
import { api } from '@/lib/api';

export const plannerApi = {
  /** Blocks overlapping [from, to] inclusive (YYYY-MM-DD). */
  list: (from: string, to: string) => api.get<PlannerBlock[]>(`/planner?from=${from}&to=${to}`),
  create: (input: PlannerBlockInput) => api.post<PlannerBlock>('/planner', input),
  update: (id: string, patch: UpdatePlannerBlockInput) => api.patch<PlannerBlock>(`/planner/${id}`, patch),
  remove: (id: string) => api.delete<{ ok: boolean }>(`/planner/${id}`),
  /** Reassign `date`'s ordered block ids (move between days + reorder). */
  reorder: (date: string, ids: string[]) => api.post<{ ok: boolean }>('/planner/reorder', { date, ids }),
  /** Copy a week's blocks forward by 7 days. */
  rollover: (weekStart: string) => api.post<{ copied: number }>('/planner/rollover', { weekStart }),
};
