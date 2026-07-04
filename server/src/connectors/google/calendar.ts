import { googleClient } from './client.js';
import { logger } from '../../lib/logger.js';

export interface GoogleEventInput {
  title: string;
  /** ISO-8601 with offset (e.g. 2026-06-24T09:00:00.000Z). */
  startAt: string;
  endAt: string;
  location?: string | null;
  notes?: string | null;
  /** Guest email addresses to invite. */
  attendees?: string[];
}

interface GoogleEvent {
  id?: string;
  htmlLink?: string;
  attendees?: { email?: string }[];
}

export interface GoogleEventResult {
  googleId: string;
  attendees: number;
  htmlLink: string | null;
}

const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** Builds the events.insert/patch body + the validated attendee list. */
function buildBody(input: GoogleEventInput): { body: Record<string, unknown>; attendees: { email: string }[] } {
  const guests = (input.attendees ?? []).map((e) => e.trim().toLowerCase()).filter(isEmail);
  const attendees = [...new Set(guests)].map((email) => ({ email }));
  const body: Record<string, unknown> = {
    summary: input.title,
    start: { dateTime: input.startAt },
    end: { dateTime: input.endAt },
  };
  if (input.notes) body.description = input.notes;
  if (input.location) body.location = input.location;
  if (attendees.length) body.attendees = attendees;
  return { body, attendees };
}

/** Creates an event on the user's primary Google Calendar and invites any guests. */
export async function createCalendarEvent(tenantId: string, input: GoogleEventInput): Promise<GoogleEventResult> {
  const { body, attendees } = buildBody(input);
  const qs = attendees.length ? '?sendUpdates=all' : '';
  const ev = await googleClient.post<GoogleEvent>(tenantId, `${EVENTS_URL}${qs}`, body);
  return { googleId: ev.id ?? '', attendees: ev.attendees?.length ?? attendees.length, htmlLink: ev.htmlLink ?? null };
}

/**
 * Patches an existing Google Calendar event. events.patch REPLACES the attendees
 * array wholesale, and the client only sends newly-added guests — so to avoid wiping
 * existing invitees we read the event's current attendees and UNION the new ones in
 * (preserving each attendee's RSVP object). When no guests are supplied, attendees is
 * left untouched. (Guest removal is therefore done in Google, not here.)
 */
export async function updateCalendarEvent(
  tenantId: string,
  googleEventId: string,
  input: GoogleEventInput,
): Promise<GoogleEventResult> {
  const newGuests = [...new Set((input.attendees ?? []).map((e) => e.trim().toLowerCase()).filter(isEmail))];

  const body: Record<string, unknown> = {
    summary: input.title,
    start: { dateTime: input.startAt },
    end: { dateTime: input.endAt },
  };
  if (input.notes) body.description = input.notes;
  if (input.location) body.location = input.location;

  let attendeeCount = 0;
  if (newGuests.length) {
    let current: Record<string, unknown>[] = [];
    try {
      const existing = await googleClient.get<{ attendees?: Record<string, unknown>[] }>(
        tenantId,
        `${EVENTS_URL}/${encodeURIComponent(googleEventId)}?fields=attendees`,
      );
      current = existing.attendees ?? [];
    } catch {
      /* no current attendees readable — fall back to just the new guests */
    }
    const have = new Set(current.map((a) => String(a.email ?? '').toLowerCase()));
    const merged = [...current, ...newGuests.filter((e) => !have.has(e)).map((email) => ({ email }))];
    body.attendees = merged;
    attendeeCount = merged.length;
  }

  const qs = newGuests.length ? '?sendUpdates=all' : '';
  const ev = await googleClient.patch<GoogleEvent>(
    tenantId,
    `${EVENTS_URL}/${encodeURIComponent(googleEventId)}${qs}`,
    body,
  );
  return { googleId: ev.id ?? googleEventId, attendees: ev.attendees?.length ?? attendeeCount, htmlLink: ev.htmlLink ?? null };
}

/** Deletes an event from the user's primary Google Calendar (notifies guests). */
export async function deleteCalendarEvent(tenantId: string, googleEventId: string): Promise<void> {
  await googleClient.del(tenantId, `${EVENTS_URL}/${encodeURIComponent(googleEventId)}?sendUpdates=all`);
}

// ── Live attendees (meeting-detection banner + recording attribution) ─────────
export interface EventAttendee {
  name: string | null;
  email: string;
}

/**
 * Fetches the live attendee list of one primary-calendar event. Best-effort by
 * design: no Google grant, a deleted event, or a network failure all yield []
 * so callers (the recorder pipeline) degrade gracefully.
 */
export async function getEventAttendees(tenantId: string, googleEventId: string): Promise<EventAttendee[]> {
  try {
    if (!(await googleClient.isConnected(tenantId))) return [];
    const fields = encodeURIComponent('attendees(displayName,email)');
    const ev = await googleClient.get<{ attendees?: { displayName?: string; email?: string }[] }>(
      tenantId,
      `${EVENTS_URL}/${encodeURIComponent(googleEventId)}?fields=${fields}`,
    );
    const out: EventAttendee[] = [];
    for (const a of ev.attendees ?? []) {
      const email = a.email?.trim();
      if (!email) continue;
      out.push({ name: a.displayName?.trim() || null, email });
    }
    return out;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), googleEventId },
      'event attendees fetch failed',
    );
    return [];
  }
}

// ── Guest suggestions (People API) ─────────────────────────────────────────────
export interface PersonSuggestion {
  name: string;
  email: string;
  /** Organization name from the contact/directory profile, when present. */
  company: string | null;
  /** Job title from the contact/directory profile, when present. */
  role: string | null;
}
interface PeoplePerson {
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string }[];
  organizations?: { name?: string; title?: string }[];
}
interface PeopleResult {
  results?: { person?: PeoplePerson }[];
  people?: PeoplePerson[];
}

function mapPeople(data: PeopleResult): PersonSuggestion[] {
  const rows = data.results?.map((r) => r.person) ?? data.people ?? [];
  const out: PersonSuggestion[] = [];
  for (const p of rows) {
    const email = p?.emailAddresses?.[0]?.value?.trim();
    if (!email) continue;
    const org = p?.organizations?.[0];
    out.push({
      name: p?.names?.[0]?.displayName?.trim() || email,
      email,
      company: org?.name?.trim() || null,
      role: org?.title?.trim() || null,
    });
  }
  return out;
}

/**
 * Suggests guests for the add-guest box — searches the user's contacts and the
 * Workspace directory (coworkers), like Google Calendar's autocomplete. Each source
 * is best-effort: a missing scope simply yields no results from that source.
 */
export async function searchPeople(tenantId: string, query: string): Promise<PersonSuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const readMask = encodeURIComponent('names,emailAddresses,organizations');
  const enc = encodeURIComponent(q);

  const onErr = (source: string) => (err: unknown) => {
    // Surfaced (not swallowed) so an unenabled People API / missing scope is diagnosable.
    logger.warn({ err: err instanceof Error ? err.message : String(err), source }, 'people search failed');
    return [] as PersonSuggestion[];
  };

  const directory = googleClient
    .get<PeopleResult>(
      tenantId,
      `https://people.googleapis.com/v1/people:searchDirectoryPeople?query=${enc}&readMask=${readMask}&sources=DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE&pageSize=10`,
    )
    .then(mapPeople)
    .catch(onErr('directory'));

  const contacts = googleClient
    .get<PeopleResult>(
      tenantId,
      `https://people.googleapis.com/v1/people:searchContacts?query=${enc}&readMask=${readMask}&pageSize=10`,
    )
    .then(mapPeople)
    .catch(onErr('contacts'));

  const [dir, con] = await Promise.all([directory, contacts]);
  const seen = new Set<string>();
  const merged: PersonSuggestion[] = [];
  for (const p of [...dir, ...con]) {
    const key = p.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(p);
    if (merged.length >= 8) break;
  }
  return merged;
}
