import type { BulkPeopleResult, ContactSuggestion, Person, PersonContext, PersonInput } from '@iris/shared';
import { api } from '@/lib/api';

/** People & Context endpoints (roster CRUD + per-person drawer context). */
export const peopleApi = {
  list: () => api.get<Person[]>('/people'),
  create: (input: PersonInput) => api.post<Person>('/people', input),
  bulkCreate: (people: PersonInput[]) => api.post<BulkPeopleResult>('/people/bulk', { people }),
  bulkRemove: (ids: string[]) => api.post<{ removed: number }>('/people/bulk-remove', { ids }),
  update: (id: string, patch: PersonInput) => api.patch<Person>(`/people/${id}`, patch),
  remove: (id: string) => api.delete<{ ok: boolean }>(`/people/${id}`),
  context: (id: string) => api.get<PersonContext>(`/people/${id}/context`),
  /** Google Contacts + Workspace directory autocomplete (name/company/role included). */
  contactSuggest: (q: string) => api.get<ContactSuggestion[]>(`/people/contact-suggest?q=${encodeURIComponent(q)}`),
};
