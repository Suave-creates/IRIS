import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionUser } from '@iris/shared';
import { authApi } from './api';

export const sessionKey = ['session'] as const;

/** Current authenticated user (or null). Cached; the app reads this everywhere. */
export function useSession(): { user: SessionUser | null; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: sessionKey,
    queryFn: () => authApi.session(),
    staleTime: 60_000,
    retry: false,
  });
  return { user: data?.user ?? null, isLoading };
}

export function useAuthProviders() {
  return useQuery({
    queryKey: ['auth-providers'],
    queryFn: () => authApi.providers(),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => {
      qc.setQueryData(sessionKey, { user: null });
      qc.clear();
    },
  });
}
