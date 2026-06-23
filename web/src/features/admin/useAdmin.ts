import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import { adminApi } from './api';

const adminOverviewKey = ['admin', 'overview'] as const;

/**
 * Admin overview (KPIs, users, system health, audit log). The endpoint is
 * gated to owner/admin roles — a 403 is an expected outcome for members, so
 * we never retry it and the view renders an "Admins only" empty state.
 */
export function useAdminOverview() {
  return useQuery({
    queryKey: adminOverviewKey,
    queryFn: () => adminApi.overview(),
    retry: (failureCount, err) => {
      if (err instanceof ApiError && (err.status === 403 || err.status === 401)) return false;
      return failureCount < 2;
    },
    staleTime: 30_000,
  });
}
