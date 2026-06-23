import { googleClient } from './client.js';

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

/**
 * Creates an event on the user's primary Google Calendar and invites any guests.
 * Requires the calendar.events write scope (the user must reconnect Google to grant it).
 */
export async function createCalendarEvent(tenantId: string, input: GoogleEventInput): Promise<GoogleEventResult> {
  const guests = (input.attendees ?? [])
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const attendees = [...new Set(guests)].map((email) => ({ email }));

  const body: Record<string, unknown> = {
    summary: input.title,
    start: { dateTime: input.startAt },
    end: { dateTime: input.endAt },
  };
  if (input.notes) body.description = input.notes;
  if (input.location) body.location = input.location;
  if (attendees.length) body.attendees = attendees;

  // sendUpdates=all so guests receive the invite email.
  const qs = attendees.length ? '?sendUpdates=all' : '';
  const ev = await googleClient.post<GoogleEvent>(
    tenantId,
    `https://www.googleapis.com/calendar/v3/calendars/primary/events${qs}`,
    body,
  );
  return {
    googleId: ev.id ?? '',
    attendees: ev.attendees?.length ?? attendees.length,
    htmlLink: ev.htmlLink ?? null,
  };
}
