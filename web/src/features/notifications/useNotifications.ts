import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from './api';

const key = ['notifications'] as const;

export function useNotifications() {
  return useQuery({ queryKey: key, queryFn: () => notificationsApi.list(), staleTime: 30_000 });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => notificationsApi.readAll(),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}
