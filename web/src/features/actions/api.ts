import type { ActionProposal } from '@iris/shared';
import { api } from '@/lib/api';

export const actionsApi = {
  pending: () => api.get<ActionProposal[]>('/actions?status=pending'),
  approve: (id: string) => api.post<ActionProposal>(`/actions/${id}/approve`),
  reject: (id: string) => api.post<ActionProposal>(`/actions/${id}/reject`),
  approveAll: () => api.post<ActionProposal[]>('/actions/approve-all'),
  rejectAll: () => api.post<ActionProposal[]>('/actions/reject-all'),
};
