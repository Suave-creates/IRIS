import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Project, ProjectSource } from '@iris/shared';
import { projectsApi, type AddSourceInput } from './api';

const projectsKey = ['projects'] as const;
const sourcesKey = ['projects', 'sources'] as const;

/** The project list is fully hydrated (tasks/files/activity inline), so the
 *  detail modal reads straight from this cache — no separate useProject hook. */
export function useProjects() {
  return useQuery({ queryKey: projectsKey, queryFn: () => projectsApi.list() });
}

export function useProjectSources() {
  return useQuery({ queryKey: sourcesKey, queryFn: () => projectsApi.sources() });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: projectsApi.create,
    onSuccess: (created) => {
      // Prepend the new project for instant feedback before the refetch lands.
      qc.setQueryData<Project[]>(projectsKey, (prev) => (prev ? [created, ...prev] : [created]));
      void qc.invalidateQueries({ queryKey: projectsKey });
    },
  });
}

export function useToggleProjectTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, taskId }: { projectId: string; taskId: string }) =>
      projectsApi.toggleTask(projectId, taskId),
    // Optimistically flip the task's done flag for an instant checkbox response.
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
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(projectsKey, ctx.prev);
    },
    // Reconcile with the server's recomputed progress/status.
    onSettled: () => qc.invalidateQueries({ queryKey: projectsKey }),
  });
}

export function useAddSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddSourceInput) => projectsApi.addSource(input),
    onSuccess: (created) => {
      qc.setQueryData<ProjectSource[]>(sourcesKey, (prev) => (prev ? [...prev, created] : [created]));
      void qc.invalidateQueries({ queryKey: sourcesKey });
    },
  });
}

export function useFetchProjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => projectsApi.fetch(),
    // The fetch may surface freshly-extracted projects and rescan sources.
    onSuccess: (projects) => {
      qc.setQueryData<Project[]>(projectsKey, projects);
      void qc.invalidateQueries({ queryKey: sourcesKey });
    },
  });
}
