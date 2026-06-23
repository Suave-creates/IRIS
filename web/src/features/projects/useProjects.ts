import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Project, ProjectSource, UpdateProjectInput } from '@iris/shared';
import { projectsApi, type LinkByRefInput, type LinkSourceInput } from './api';

const projectsKey = ['projects'] as const;
const sourcesKey = ['projects', 'sources'] as const;

/** The project list is fully hydrated, so the detail modal reads it live from this cache. */
export function useProjects() {
  return useQuery({ queryKey: projectsKey, queryFn: () => projectsApi.list() });
}

export function useProjectSources() {
  return useQuery({ queryKey: sourcesKey, queryFn: () => projectsApi.sources() });
}

/** Replaces the cached copy of a project with the server's updated version. */
function applyProject(qc: QueryClient, updated: Project | null) {
  if (!updated) return;
  qc.setQueryData<Project[]>(projectsKey, (prev) =>
    prev ? prev.map((p) => (p.id === updated.id ? updated : p)) : [updated],
  );
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: projectsApi.create,
    onSuccess: (created) => {
      qc.setQueryData<Project[]>(projectsKey, (prev) => (prev ? [created, ...prev] : [created]));
      void qc.invalidateQueries({ queryKey: projectsKey });
    },
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateProjectInput }) => projectsApi.update(id, patch),
    onSuccess: (updated) => applyProject(qc, updated),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => projectsApi.remove(id),
    onSuccess: (_r, id) => {
      qc.setQueryData<Project[]>(projectsKey, (prev) => prev?.filter((p) => p.id !== id) ?? []);
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useToggleProjectTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, taskId }: { projectId: string; taskId: string }) =>
      projectsApi.toggleTask(projectId, taskId),
    onMutate: async ({ projectId, taskId }) => {
      await qc.cancelQueries({ queryKey: projectsKey });
      const prev = qc.getQueryData<Project[]>(projectsKey);
      if (prev) {
        qc.setQueryData<Project[]>(
          projectsKey,
          prev.map((p) =>
            p.id !== projectId
              ? p
              : { ...p, tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)) },
          ),
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(projectsKey, ctx.prev);
    },
    onSuccess: (updated) => applyProject(qc, updated),
  });
}

/** Task + field add/edit/delete — each returns the refreshed project. */
export function useProjectTaskMutations() {
  const qc = useQueryClient();
  return {
    add: useMutation({
      mutationFn: ({ projectId, title }: { projectId: string; title: string }) => projectsApi.addTask(projectId, title),
      onSuccess: (u) => applyProject(qc, u),
    }),
    edit: useMutation({
      mutationFn: (v: { projectId: string; taskId: string; title?: string; done?: boolean }) =>
        projectsApi.updateTask(v.projectId, v.taskId, { title: v.title, done: v.done }),
      onSuccess: (u) => applyProject(qc, u),
    }),
    remove: useMutation({
      mutationFn: ({ projectId, taskId }: { projectId: string; taskId: string }) =>
        projectsApi.deleteTask(projectId, taskId),
      onSuccess: (u) => applyProject(qc, u),
    }),
  };
}

export function useProjectFieldMutations() {
  const qc = useQueryClient();
  return {
    add: useMutation({
      mutationFn: (v: { projectId: string; label: string; value: string }) =>
        projectsApi.addField(v.projectId, v.label, v.value),
      onSuccess: (u) => applyProject(qc, u),
    }),
    edit: useMutation({
      mutationFn: (v: { projectId: string; fieldId: string; label: string; value: string }) =>
        projectsApi.updateField(v.projectId, v.fieldId, v.label, v.value),
      onSuccess: (u) => applyProject(qc, u),
    }),
    remove: useMutation({
      mutationFn: ({ projectId, fieldId }: { projectId: string; fieldId: string }) =>
        projectsApi.deleteField(projectId, fieldId),
      onSuccess: (u) => applyProject(qc, u),
    }),
  };
}

export function useLinkSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LinkSourceInput) => projectsApi.linkSource(input),
    onSuccess: (created) => {
      qc.setQueryData<ProjectSource[]>(sourcesKey, (prev) => (prev ? [...prev, created] : [created]));
      void qc.invalidateQueries({ queryKey: sourcesKey });
    },
  });
}

/** Links a source from a pasted Google URL or ID (reliable when listing is blocked). */
export function useLinkSourceByRef() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LinkByRefInput) => projectsApi.linkSourceByRef(input),
    onSuccess: (created) => {
      qc.setQueryData<ProjectSource[]>(sourcesKey, (prev) => (prev ? [...prev, created] : [created]));
      void qc.invalidateQueries({ queryKey: sourcesKey });
    },
  });
}

export function useDeleteSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => projectsApi.deleteSource(id),
    onSuccess: (_r, id) =>
      qc.setQueryData<ProjectSource[]>(sourcesKey, (prev) => prev?.filter((s) => s.id !== id) ?? []),
  });
}

/** Lazily lists real Drive items of a type (only fetches when `type` is set). */
export function useAvailableSources(type: ProjectSource['type'] | null) {
  return useQuery({
    queryKey: ['projects', 'available', type],
    queryFn: () => projectsApi.availableSources(type as ProjectSource['type']),
    enabled: type !== null,
    staleTime: 30_000,
  });
}

export function useFetchProjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => projectsApi.fetch(),
    onSuccess: (projects) => {
      qc.setQueryData<Project[]>(projectsKey, projects);
      void qc.invalidateQueries({ queryKey: sourcesKey });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
