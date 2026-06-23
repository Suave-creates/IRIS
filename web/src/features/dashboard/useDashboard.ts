import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from './api';

export const dashboardKey = ['dashboard'] as const;

export function useDashboard() {
  return useQuery({ queryKey: dashboardKey, queryFn: () => dashboardApi.get() });
}
