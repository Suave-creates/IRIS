import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { UpdateWhiteboardItemInput, WhiteboardItem } from '@iris/shared';
import { whiteboardApi } from './api';

const KEY = ['whiteboard'] as const;

export function useWhiteboard() {
  return useQuery({ queryKey: KEY, queryFn: () => whiteboardApi.list() });
}

function appendItem(qc: QueryClient, item: WhiteboardItem) {
  qc.setQueryData<WhiteboardItem[]>(KEY, (prev) => (prev ? [...prev, item] : [item]));
}
function applyItem(qc: QueryClient, item: WhiteboardItem) {
  qc.setQueryData<WhiteboardItem[]>(KEY, (prev) =>
    prev ? prev.map((i) => (i.id === item.id ? item : i)) : [item],
  );
}
function dropItem(qc: QueryClient, itemId: string) {
  qc.setQueryData<WhiteboardItem[]>(KEY, (prev) => prev?.filter((i) => i.id !== itemId) ?? []);
}

/** All canvas mutations, each reconciling the cache without a refetch (smooth dragging). */
export function useWhiteboardMutations() {
  const qc = useQueryClient();
  return {
    add: useMutation({ mutationFn: whiteboardApi.add, onSuccess: (item) => appendItem(qc, item) }),
    addByRef: useMutation({ mutationFn: whiteboardApi.addByRef, onSuccess: (item) => appendItem(qc, item) }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: UpdateWhiteboardItemInput }) => whiteboardApi.update(id, patch),
      onSuccess: (item) => applyItem(qc, item),
    }),
    remove: useMutation({
      mutationFn: (id: string) => whiteboardApi.remove(id),
      onSuccess: (_r, id) => dropItem(qc, id),
    }),
    ai: useMutation({ mutationFn: whiteboardApi.ai, onSuccess: (item) => appendItem(qc, item) }),
  };
}
