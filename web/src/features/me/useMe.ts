import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { meApi, type MeBundle, type UserSettings } from './api';

const meKey = ['me'] as const;
const sessionsKey = ['me', 'sessions'] as const;

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: () => meApi.profile() });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: UserSettings) => meApi.updateSettings(settings),
    // Optimistically reflect the change for instant feedback.
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: meKey });
      const prev = qc.getQueryData<MeBundle>(meKey);
      if (prev) qc.setQueryData<MeBundle>(meKey, { ...prev, settings: next });
      return { prev };
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.prev) qc.setQueryData(meKey, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: meKey }),
  });
}

export function useSessions() {
  return useQuery({ queryKey: sessionsKey, queryFn: () => meApi.sessions() });
}

export function useRevokeOtherSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => meApi.revokeOthers(),
    onSuccess: () => qc.invalidateQueries({ queryKey: sessionsKey }),
  });
}
