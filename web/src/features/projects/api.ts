import type { CreateProjectInput, Project, ProjectSource } from '@iris/shared';
import { api } from '@/lib/api';

/** Payload for linking a new source the IRIS scans for projects. */
export interface AddSourceInput {
  type: ProjectSource['type'];
  name: string;
  meta?: string | null;
}

export const projectsApi = {
  list: () => api.get<Project[]>('/projects'),
  create: (input: CreateProjectInput) => api.post<Project>('/projects', input),
  toggleTask: (projectId: string, taskId: string) =>
    api.patch<Project>(`/projects/${projectId}/tasks/${taskId}`, {}),
  sources: () => api.get<ProjectSource[]>('/projects/sources'),
  addSource: (input: AddSourceInput) => api.post<ProjectSource>('/projects/sources', input),
  fetch: () => api.post<Project[]>('/projects/fetch'),
};
