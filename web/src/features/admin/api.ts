import type { AdminOverview } from '@iris/shared';
import { api } from '@/lib/api';

export const adminApi = {
  overview: () => api.get<AdminOverview>('/admin/overview'),
};
