import type { JournalTask, JournalTaskInput } from '@iris/shared';
import { api } from '@/lib/api';

/** Journal task endpoints (caller's own tasks, scoped by the session on the server). */
export const journalApi = {
  /** List tasks whose dueDate falls within [from, to] (inclusive), YYYY-MM-DD. */
  list: (from: string, to: string) =>
    api.get<JournalTask[]>(`/journal/tasks?from=${from}&to=${to}`),
  create: (input: JournalTaskInput) => api.post<JournalTask>('/journal/tasks', input),
  update: (id: string, input: JournalTaskInput) =>
    api.put<JournalTask>(`/journal/tasks/${id}`, input),
  remove: (id: string) => api.delete<{ ok: true }>(`/journal/tasks/${id}`),
};

export type { JournalTask, JournalTaskInput };
