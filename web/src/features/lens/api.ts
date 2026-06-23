import type { LensGather } from '@iris/shared';
import { api } from '@/lib/api';

export const lensApi = {
  gather: (keyword: string) => api.post<LensGather>('/lens/gather', { keyword }),
};
