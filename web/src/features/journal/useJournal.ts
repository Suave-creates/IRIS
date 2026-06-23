import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JournalTask, JournalTaskInput } from '@iris/shared';
import { journalApi } from './api';

const journalKey = (from: string, to: string) => ['journal', 'tasks', from, to] as const;

/** Tasks whose dueDate is within [from, to] (inclusive). Kept fresh across day cells. */
export function useJournalTasks(from: string, to: string) {
  return useQuery({
    queryKey: journalKey(from, to),
    queryFn: () => journalApi.list(from, to),
    placeholderData: (prev) => prev,
  });
}

export function useCreateTask(from: string, to: string) {
  const qc = useQueryClient();
  const key = journalKey(from, to);
  return useMutation({
    mutationFn: (input: JournalTaskInput) => journalApi.create(input),
    // Show the new chip immediately with a temporary id; reconcile on settle.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<JournalTask[]>(key);
      const optimistic: JournalTask = {
        id: `tmp-${Date.now()}`,
        title: input.title,
        dueDate: input.dueDate,
        dueTime: input.dueTime ?? null,
        priority: input.priority,
        done: input.done ?? false,
        detail: input.detail ?? null,
      };
      qc.setQueryData<JournalTask[]>(key, [...(prev ?? []), optimistic]);
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useUpdateTask(from: string, to: string) {
  const qc = useQueryClient();
  const key = journalKey(from, to);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: JournalTaskInput }) =>
      journalApi.update(id, input),
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<JournalTask[]>(key);
      qc.setQueryData<JournalTask[]>(key, (cur) =>
        (cur ?? []).map((t) =>
          t.id === id
            ? {
                ...t,
                title: input.title,
                dueDate: input.dueDate,
                dueTime: input.dueTime ?? null,
                priority: input.priority,
                done: input.done ?? false,
                detail: input.detail ?? null,
              }
            : t,
        ),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useDeleteTask(from: string, to: string) {
  const qc = useQueryClient();
  const key = journalKey(from, to);
  return useMutation({
    mutationFn: (id: string) => journalApi.remove(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<JournalTask[]>(key);
      qc.setQueryData<JournalTask[]>(key, (cur) => (cur ?? []).filter((t) => t.id !== id));
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}
