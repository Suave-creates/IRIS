import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { freqLabel } from '@iris/shared';
import type { BulkPeopleResult, Person, PersonInput } from '@iris/shared';
import { peopleApi } from './api';

/** Roster cache key — also the shared prefix of every person-context query. */
export const peopleKey = ['people'] as const;

/** The roster with server-computed engagement; the drawer header reads it live. */
export function usePeople() {
  return useQuery({ queryKey: peopleKey, queryFn: () => peopleApi.list() });
}

/** Drawer payload; under the ['people'] prefix so meeting invalidations refresh it too. */
export function usePersonContext(personId: string | null) {
  return useQuery({
    queryKey: ['people', 'context', personId] as const,
    queryFn: () => peopleApi.context(personId as string),
    enabled: !!personId,
  });
}

/** Debounced-by-caller contact autocomplete; empty query disables the fetch. */
export function useContactSuggestions(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: ['people', 'contact-suggest', query] as const,
    queryFn: () => peopleApi.contactSuggest(query),
    enabled: query.length >= 2,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useCreatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PersonInput) => peopleApi.create(input),
    onSuccess: (created) => {
      qc.setQueryData<Person[]>(peopleKey, (prev) => (prev ? [created, ...prev] : [created]));
      void qc.invalidateQueries({ queryKey: peopleKey });
    },
  });
}

/** The server accepts at most this many people per bulk request. */
const BULK_CHUNK = 200;

/** Bulk roster import (paste from the weekly planner). Large pastes are chunked. */
export function useBulkCreatePeople() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (people: PersonInput[]): Promise<BulkPeopleResult> => {
      const created: BulkPeopleResult['created'] = [];
      const skipped: string[] = [];
      for (let i = 0; i < people.length; i += BULK_CHUNK) {
        const result = await peopleApi.bulkCreate(people.slice(i, i + BULK_CHUNK));
        created.push(...result.created);
        skipped.push(...result.skipped);
      }
      return { created, skipped };
    },
    onSuccess: (result) => {
      qc.setQueryData<Person[]>(peopleKey, (prev) => [...result.created, ...(prev ?? [])]);
      void qc.invalidateQueries({ queryKey: peopleKey });
    },
  });
}

/** Optimistic update so day-cell toggles land instantly; engagement reconciles on success. */
export function useUpdatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PersonInput }) => peopleApi.update(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: peopleKey });
      const prev = qc.getQueryData<Person[]>(peopleKey);
      if (prev) {
        qc.setQueryData<Person[]>(
          peopleKey,
          prev.map((p) => (p.id === id ? { ...p, ...patch, cadence: freqLabel(patch.days.length) } : p)),
        );
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(peopleKey, ctx.prev);
    },
    onSuccess: (updated) => {
      qc.setQueryData<Person[]>(peopleKey, (prev) =>
        prev ? prev.map((p) => (p.id === updated.id ? updated : p)) : [updated],
      );
    },
    // The roster cache is already reconciled from the response — only the
    // derived drawer payload needs a refetch, not the whole roster.
    onSettled: () => void qc.invalidateQueries({ queryKey: ['people', 'context'] }),
  });
}

/** Bulk remove; requests are chunked to the server's per-request cap. */
export function useBulkRemovePeople() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]): Promise<{ removed: number }> => {
      let removed = 0;
      for (let i = 0; i < ids.length; i += BULK_REMOVE_CHUNK) {
        const result = await peopleApi.bulkRemove(ids.slice(i, i + BULK_REMOVE_CHUNK));
        removed += result.removed;
      }
      return { removed };
    },
    onSuccess: (_result, ids) => {
      const gone = new Set(ids);
      qc.setQueryData<Person[]>(peopleKey, (prev) => prev?.filter((p) => !gone.has(p.id)) ?? []);
      void qc.invalidateQueries({ queryKey: peopleKey });
    },
  });
}

/** The server accepts at most this many ids per bulk-remove request. */
const BULK_REMOVE_CHUNK = 500;

export function useDeletePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => peopleApi.remove(id),
    onSuccess: (_res, id) => {
      qc.setQueryData<Person[]>(peopleKey, (prev) => prev?.filter((p) => p.id !== id) ?? []);
      void qc.invalidateQueries({ queryKey: peopleKey });
    },
  });
}
