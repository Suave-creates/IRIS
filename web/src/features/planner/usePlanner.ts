import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlannerBlock, PlannerBlockInput, UpdatePlannerBlockInput } from '@iris/shared';
import { plannerApi } from './api';

/** All planner queries share this root key so any mutation can refresh the visible range. */
const plannerRoot = ['planner'] as const;

export function usePlannerBlocks(from: string, to: string) {
  return useQuery({
    queryKey: ['planner', from, to] as const,
    queryFn: () => plannerApi.list(from, to),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useCreatePlannerBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PlannerBlockInput) => plannerApi.create(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: plannerRoot }),
  });
}

export function useUpdatePlannerBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdatePlannerBlockInput }) => plannerApi.update(id, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: plannerRoot }),
  });
}

export function useReorderPlannerBlocks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ date, ids }: { date: string; ids: string[] }) => plannerApi.reorder(date, ids),
    onSettled: () => void qc.invalidateQueries({ queryKey: plannerRoot }),
  });
}

export function useRolloverWeek() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (weekStart: string) => plannerApi.rollover(weekStart),
    onSuccess: () => void qc.invalidateQueries({ queryKey: plannerRoot }),
  });
}

export function useDeletePlannerBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => plannerApi.remove(id),
    // Optimistically drop it from every cached range.
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: plannerRoot });
      const snapshots = qc.getQueriesData<PlannerBlock[]>({ queryKey: plannerRoot });
      for (const [key, data] of snapshots) {
        if (data) qc.setQueryData<PlannerBlock[]>(key, data.filter((b) => b.id !== id));
      }
      return { snapshots };
    },
    onError: (_e, _id, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: plannerRoot }),
  });
}
