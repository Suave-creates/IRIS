import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActionProposal } from '@iris/shared';
import { dashboardKey } from '@/features/dashboard/useDashboard';
import { actionsApi } from './api';

export const pendingActionsKey = ['actions', 'pending'] as const;

export function usePendingActions(enabled = true) {
  return useQuery({
    queryKey: pendingActionsKey,
    queryFn: () => actionsApi.pending(),
    enabled,
  });
}

/** Drop a single proposal from the cached pending list (optimistic decision). */
function removeFromPending(qc: ReturnType<typeof useQueryClient>, id: string) {
  const prev = qc.getQueryData<ActionProposal[]>(pendingActionsKey);
  if (prev) {
    qc.setQueryData<ActionProposal[]>(
      pendingActionsKey,
      prev.filter((a) => a.id !== id),
    );
  }
  return prev;
}

export function useApproveAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => actionsApi.approve(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: pendingActionsKey });
      const prev = removeFromPending(qc, id);
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(pendingActionsKey, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: pendingActionsKey });
      qc.invalidateQueries({ queryKey: dashboardKey });
    },
  });
}

export function useRejectAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => actionsApi.reject(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: pendingActionsKey });
      const prev = removeFromPending(qc, id);
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(pendingActionsKey, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: pendingActionsKey });
      qc.invalidateQueries({ queryKey: dashboardKey });
    },
  });
}

export function useApproveAllActions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => actionsApi.approveAll(),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: pendingActionsKey });
      const prev = qc.getQueryData<ActionProposal[]>(pendingActionsKey);
      qc.setQueryData<ActionProposal[]>(pendingActionsKey, []);
      return { prev };
    },
    onError: (_err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(pendingActionsKey, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: pendingActionsKey });
      qc.invalidateQueries({ queryKey: dashboardKey });
    },
  });
}

export function useRejectAllActions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => actionsApi.rejectAll(),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: pendingActionsKey });
      const prev = qc.getQueryData<ActionProposal[]>(pendingActionsKey);
      qc.setQueryData<ActionProposal[]>(pendingActionsKey, []);
      return { prev };
    },
    onError: (_err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(pendingActionsKey, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: pendingActionsKey });
      qc.invalidateQueries({ queryKey: dashboardKey });
    },
  });
}
