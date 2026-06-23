import type { Connector } from '@iris/shared';
import { api } from '@/lib/api';

export const connectorsApi = {
  /** Every connector belonging to the caller's tenant. */
  list: () => api.get<Connector[]>('/connectors'),
};
