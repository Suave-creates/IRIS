import type { CalendarEvent, CalendarEventInput } from '@iris/shared';
import { api } from '@/lib/api';

/** Calendar API surface. Mirrors the server module mounted at `/api/calendar`. */
export const calendarApi = {
  /** List events whose start falls inside [from, to). Both are ISO instants. */
  list: (from: string, to: string) =>
    api.get<CalendarEvent[]>(`/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  create: (input: CalendarEventInput) => api.post<CalendarEvent>('/calendar/events', input),
  update: (id: string, input: CalendarEventInput) => api.put<CalendarEvent>(`/calendar/events/${id}`, input),
  remove: (id: string) => api.delete<{ ok: true }>(`/calendar/events/${id}`),
};
