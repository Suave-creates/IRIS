import type { AvailableSource, CreateKpiInput, Kpi, ProjectSource, UpdateKpiInput } from '@iris/shared';
import { api } from '@/lib/api';

export interface LinkSourceInput {
  type: ProjectSource['type'];
  externalId: string;
  name: string;
  webLink?: string | null;
}
export interface LinkByRefInput {
  type: ProjectSource['type'];
  ref: string;
}

export const kpiApi = {
  list: () => api.get<Kpi[]>('/kpi'),
  create: (input: CreateKpiInput) => api.post<Kpi>('/kpi', input),
  update: (id: string, patch: UpdateKpiInput) => api.put<Kpi>(`/kpi/${id}`, patch),
  remove: (id: string) => api.delete<{ ok: boolean }>(`/kpi/${id}`),

  toggleInitiative: (kpiId: string, initiativeId: string) =>
    api.patch<Kpi>(`/kpi/${kpiId}/initiatives/${initiativeId}`, {}),
  addInitiative: (kpiId: string, title: string) => api.post<Kpi>(`/kpi/${kpiId}/initiatives`, { title }),
  deleteInitiative: (kpiId: string, initiativeId: string) => api.delete<Kpi>(`/kpi/${kpiId}/initiatives/${initiativeId}`),

  addField: (kpiId: string, label: string, value: string) => api.post<Kpi>(`/kpi/${kpiId}/fields`, { label, value }),
  updateField: (kpiId: string, fieldId: string, label: string, value: string) =>
    api.put<Kpi>(`/kpi/${kpiId}/fields/${fieldId}`, { label, value }),
  deleteField: (kpiId: string, fieldId: string) => api.delete<Kpi>(`/kpi/${kpiId}/fields/${fieldId}`),

  sources: () => api.get<ProjectSource[]>('/kpi/sources'),
  availableSources: (type: ProjectSource['type']) => api.get<AvailableSource[]>(`/kpi/sources/available?type=${type}`),
  linkSource: (input: LinkSourceInput) => api.post<ProjectSource>('/kpi/sources', input),
  linkSourceByRef: (input: LinkByRefInput) => api.post<ProjectSource>('/kpi/sources/by-ref', input),
  deleteSource: (id: string) => api.delete<{ ok: boolean }>(`/kpi/sources/${id}`),
  fetch: () => api.post<Kpi[]>('/kpi/fetch'),
};
