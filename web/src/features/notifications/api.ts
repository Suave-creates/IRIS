import type { Notification } from '@iris/shared';
import { api } from '@/lib/api';

export const notificationsApi = {
  list: () => api.get<Notification[]>('/notifications'),
  readAll: () => api.post<{ ok: boolean }>('/notifications/read-all'),
};
