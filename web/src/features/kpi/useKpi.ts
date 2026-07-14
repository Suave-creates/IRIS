import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Kpi, ProjectSource, UpdateKpiInput } from '@iris/shared';
import { kpiApi, type LinkByRefInput, type LinkSourceInput } from './api';

const kpiKey = ['kpi'] as const;
const sourcesKey = ['kpi', 'sources'] as const;

export function useKpis() {
  return useQuery({ queryKey: kpiKey, queryFn: () => kpiApi.list() });
}
export function useKpiSources() {
  return useQuery({ queryKey: sourcesKey, queryFn: () => kpiApi.sources() });
}

function applyKpi(qc: QueryClient, updated: Kpi | null) {
  if (!updated) return;
  qc.setQueryData<Kpi[]>(kpiKey, (prev) => (prev ? prev.map((k) => (k.id === updated.id ? updated : k)) : [updated]));
}

export function useCreateKpi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: kpiApi.create,
    onSuccess: (created) => {
      qc.setQueryData<Kpi[]>(kpiKey, (prev) => (prev ? [created, ...prev] : [created]));
      void qc.invalidateQueries({ queryKey: kpiKey });
    },
  });
}

export function useUpdateKpi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateKpiInput }) => kpiApi.update(id, patch),
    onSuccess: (updated) => applyKpi(qc, updated),
  });
}

export function useDeleteKpi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => kpiApi.remove(id),
    onSuccess: (_r, id) => qc.setQueryData<Kpi[]>(kpiKey, (prev) => prev?.filter((k) => k.id !== id) ?? []),
  });
}

export function useToggleKpiInitiative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kpiId, initiativeId }: { kpiId: string; initiativeId: string }) =>
      kpiApi.toggleInitiative(kpiId, initiativeId),
    onMutate: async ({ kpiId, initiativeId }) => {
      await qc.cancelQueries({ queryKey: kpiKey });
      const prev = qc.getQueryData<Kpi[]>(kpiKey);
      if (prev) {
        qc.setQueryData<Kpi[]>(
          kpiKey,
          prev.map((k) =>
            k.id !== kpiId
              ? k
              : { ...k, initiatives: k.initiatives.map((t) => (t.id === initiativeId ? { ...t, done: !t.done } : t)) },
          ),
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(kpiKey, ctx.prev);
    },
    onSuccess: (updated) => applyKpi(qc, updated),
  });
}

export function useKpiInitiativeMutations() {
  const qc = useQueryClient();
  return {
    add: useMutation({
      mutationFn: ({ kpiId, title }: { kpiId: string; title: string }) => kpiApi.addInitiative(kpiId, title),
      onSuccess: (u) => applyKpi(qc, u),
    }),
    remove: useMutation({
      mutationFn: ({ kpiId, initiativeId }: { kpiId: string; initiativeId: string }) =>
        kpiApi.deleteInitiative(kpiId, initiativeId),
      onSuccess: (u) => applyKpi(qc, u),
    }),
  };
}

export function useKpiFieldMutations() {
  const qc = useQueryClient();
  return {
    add: useMutation({
      mutationFn: (v: { kpiId: string; label: string; value: string }) => kpiApi.addField(v.kpiId, v.label, v.value),
      onSuccess: (u) => applyKpi(qc, u),
    }),
    edit: useMutation({
      mutationFn: (v: { kpiId: string; fieldId: string; label: string; value: string }) =>
        kpiApi.updateField(v.kpiId, v.fieldId, v.label, v.value),
      onSuccess: (u) => applyKpi(qc, u),
    }),
    remove: useMutation({
      mutationFn: ({ kpiId, fieldId }: { kpiId: string; fieldId: string }) => kpiApi.deleteField(kpiId, fieldId),
      onSuccess: (u) => applyKpi(qc, u),
    }),
  };
}

export function useLinkKpiSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LinkSourceInput) => kpiApi.linkSource(input),
    onSuccess: (created) => {
      qc.setQueryData<ProjectSource[]>(sourcesKey, (prev) => (prev ? [...prev, created] : [created]));
      void qc.invalidateQueries({ queryKey: sourcesKey });
    },
  });
}
export function useLinkKpiSourceByRef() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LinkByRefInput) => kpiApi.linkSourceByRef(input),
    onSuccess: (created) => {
      qc.setQueryData<ProjectSource[]>(sourcesKey, (prev) => (prev ? [...prev, created] : [created]));
      void qc.invalidateQueries({ queryKey: sourcesKey });
    },
  });
}
export function useDeleteKpiSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => kpiApi.deleteSource(id),
    onSuccess: (_r, id) => qc.setQueryData<ProjectSource[]>(sourcesKey, (prev) => prev?.filter((s) => s.id !== id) ?? []),
  });
}
export function useAvailableKpiSources(type: ProjectSource['type'] | null) {
  return useQuery({
    queryKey: ['kpi', 'available', type],
    queryFn: () => kpiApi.availableSources(type as ProjectSource['type']),
    enabled: type !== null,
    staleTime: 30_000,
  });
}
export function useFetchKpis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => kpiApi.fetch(),
    onSuccess: (kpis) => {
      qc.setQueryData<Kpi[]>(kpiKey, kpis);
      void qc.invalidateQueries({ queryKey: sourcesKey });
    },
  });
}
