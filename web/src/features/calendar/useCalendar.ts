import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CalendarEvent, CalendarEventInput } from '@iris/shared';
import { calendarApi } from './api';

/** Query key for a week range. Range bounds are part of the key so each week caches separately. */
export const calendarKey = (from: string, to: string) => ['calendar', 'events', from, to] as const;

export function useCalendarEvents(from: string, to: string) {
  return useQuery({
    queryKey: calendarKey(from, to),
    queryFn: () => calendarApi.list(from, to),
    placeholderData: (prev) => prev, // keep last week visible while the next loads
  });
}

/** Guest autocomplete suggestions for the add-guest box (enabled at 2+ chars). */
export function useGuestSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ['calendar', 'guests', q],
    queryFn: () => calendarApi.guests(q),
    enabled: q.length >= 2,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useCreateEvent(from: string, to: string) {
  const qc = useQueryClient();
  const key = calendarKey(from, to);
  return useMutation({
    mutationFn: (input: CalendarEventInput) => calendarApi.create(input),
    // Optimistically insert a temp event so the grid updates instantly.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CalendarEvent[]>(key);
      const temp: CalendarEvent = {
        id: `tmp-${Date.now()}`,
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        color: input.color,
        location: input.location ?? null,
        notes: input.notes ?? null,
        attendees: input.attendees?.length ?? 0,
      };
      qc.setQueryData<CalendarEvent[]>(key, [...(prev ?? []), temp]);
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['calendar', 'events'] }),
  });
}

export function useUpdateEvent(from: string, to: string) {
  const qc = useQueryClient();
  const key = calendarKey(from, to);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CalendarEventInput }) => calendarApi.update(id, input),
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CalendarEvent[]>(key);
      qc.setQueryData<CalendarEvent[]>(key, (list) =>
        (list ?? []).map((e) =>
          e.id === id
            ? {
                ...e,
                title: input.title,
                startAt: input.startAt,
                endAt: input.endAt,
                color: input.color,
                location: input.location ?? null,
                notes: input.notes ?? null,
                attendees: input.attendees?.length ?? e.attendees,
              }
            : e,
        ),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['calendar', 'events'] }),
  });
}

export function useDeleteEvent(from: string, to: string) {
  const qc = useQueryClient();
  const key = calendarKey(from, to);
  return useMutation({
    mutationFn: (id: string) => calendarApi.remove(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CalendarEvent[]>(key);
      qc.setQueryData<CalendarEvent[]>(key, (list) => (list ?? []).filter((e) => e.id !== id));
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['calendar', 'events'] }),
  });
}
