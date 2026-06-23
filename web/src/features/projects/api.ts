import type { AvailableSource, CreateProjectInput, Project, ProjectSource, UpdateProjectInput } from '@iris/shared';
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

export const projectsApi = {
  list: () => api.get<Project[]>('/projects'),
  create: (input: CreateProjectInput) => api.post<Project>('/projects', input),
  update: (id: string, patch: UpdateProjectInput) => api.put<Project>(`/projects/${id}`, patch),
  remove: (id: string) => api.delete<{ ok: boolean }>(`/projects/${id}`),

  toggleTask: (projectId: string, taskId: string) => api.patch<Project>(`/projects/${projectId}/tasks/${taskId}`, {}),
  addTask: (projectId: string, title: string) => api.post<Project>(`/projects/${projectId}/tasks`, { title }),
  updateTask: (projectId: string, taskId: string, patch: { title?: string; done?: boolean }) =>
    api.put<Project>(`/projects/${projectId}/tasks/${taskId}`, patch),
  deleteTask: (projectId: string, taskId: string) => api.delete<Project>(`/projects/${projectId}/tasks/${taskId}`),

  addField: (projectId: string, label: string, value: string) =>
    api.post<Project>(`/projects/${projectId}/fields`, { label, value }),
  updateField: (projectId: string, fieldId: string, label: string, value: string) =>
    api.put<Project>(`/projects/${projectId}/fields/${fieldId}`, { label, value }),
  deleteField: (projectId: string, fieldId: string) => api.delete<Project>(`/projects/${projectId}/fields/${fieldId}`),

  sources: () => api.get<ProjectSource[]>('/projects/sources'),
  availableSources: (type: ProjectSource['type']) =>
    api.get<AvailableSource[]>(`/projects/sources/available?type=${type}`),
  linkSource: (input: LinkSourceInput) => api.post<ProjectSource>('/projects/sources', input),
  linkSourceByRef: (input: LinkByRefInput) => api.post<ProjectSource>('/projects/sources/by-ref', input),
  deleteSource: (id: string) => api.delete<{ ok: boolean }>(`/projects/sources/${id}`),
  fetch: () => api.post<Project[]>('/projects/fetch'),
};
