import type { DashboardData } from '@iris/shared';
import { api } from '@/lib/api';

export const dashboardApi = {
  get: () => api.get<DashboardData>('/dashboard'),
};
