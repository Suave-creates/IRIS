import { execute } from '../../db/pool.js';
import { googleClient } from './client.js';
import { triageEmails } from './mail.triage.js';

export interface SyncResult {
  imported: number;
  detail: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dt = (d: Date) =>
  `${ymd(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

/** Lightweight category heuristic; the fallback when AI triage is unavailable. */
export function categorize(text: string): string {
  const t = text.toLowerCase();
  if (/(approve|approval|sign[- ]?off|review needed)/.test(t)) return 'approvals';
  if (/(deadline|due|filing|expires)/.test(t)) return 'deadlines';
  if (/(invoice|payment|budget|finance|\$)/.test(t)) return 'finance';
  if (/(meeting|agenda|calendar|sync|standup)/.test(t)) return 'meetings';
  if (/(intro|introduction|connect you)/.test(t)) return 'intros';
  if (/(decision|decide|redline|contract|msa)/.test(t)) return 'decisions';
  if (/(task|action item|follow[- ]?up|todo)/.test(t)) return 'tasks';
  return 'fyi';
}

function headerValue(headers: { name: string; value: string }[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}
function displayName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*<.+>$/);
  const name = m?.[1] ?? from.split('@')[0] ?? from;
  return name.trim() || from;
}

// ── Gmail ───────────────────────────────────────────────────────────────────
interface GmailList {
  messages?: { id: string }[];
}
export interface GmailPayload {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: GmailPayload[];
}
interface GmailMessage {
  id: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPayload;
}

const MAX_MAIL_BODY = 4_000;

function decodeB64Url(data?: string): string {
  if (!data) return '';
  try {
    return Buffer.from(data, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}
/** Depth-first search for the first part of a given MIME type that carries data. */
function findPart(payload: GmailPayload, mime: string): GmailPayload | null {
  if (payload.mimeType === mime && payload.body?.data) return payload;
  for (const p of payload.parts ?? []) {
    const found = findPart(p, mime);
    if (found) return found;
  }
  return null;
}
/** Best-effort plain-text body: prefer text/plain, else stripped text/html, else top-level body. */
export function extractPlainText(payload?: GmailPayload): string {
  if (!payload) return '';
  const plain = findPart(payload, 'text/plain');
  if (plain) return decodeB64Url(plain.body?.data);
  const html = findPart(payload, 'text/html');
  if (html) return stripHtml(decodeB64Url(html.body?.data));
  return decodeB64Url(payload.body?.data);
}

export async function syncGmail(tenantId: string): Promise<SyncResult> {
  const listQs = new URLSearchParams({ maxResults: '15', q: 'newer_than:30d' }).toString();
  const list = await googleClient.get<GmailList>(
    tenantId,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${listQs}`,
  );
  const ids = (list.messages ?? []).slice(0, 15);

  // 1) Fetch full messages (body included) so the AI summary has real content.
  const emails: { gid: string; from: string; subject: string; snippet: string; body: string; received: Date }[] = [];
  for (const { id: gid } of ids) {
    const msg = await googleClient.get<GmailMessage>(
      tenantId,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gid}?format=full`,
    );
    const headers = msg.payload?.headers ?? [];
    const snippet = msg.snippet ?? '';
    const body = (extractPlainText(msg.payload) || snippet).replace(/\s+/g, ' ').trim().slice(0, MAX_MAIL_BODY);
    emails.push({
      gid,
      from: displayName(headerValue(headers, 'From')),
      subject: headerValue(headers, 'Subject') || '(no subject)',
      snippet,
      body,
      received: msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(),
    });
  }

  // 2) Batch AI triage (summary/category/priority/tags); null entries fall back to the heuristic.
  const triaged = await triageEmails(emails.map((e) => ({ from: e.from, subject: e.subject, body: e.body })));

  // 3) Persist.
  for (let i = 0; i < emails.length; i++) {
    const e = emails[i]!;
    const t = triaged[i] ?? null;
    await execute(
      `INSERT INTO mail_items (id, tenant_id, from_name, subject, summary, category, priority, received_at, tags)
       VALUES (:id, :t, :from, :subj, :sum, :cat, :pri, :rcv, :tags)
       ON DUPLICATE KEY UPDATE from_name=VALUES(from_name), subject=VALUES(subject), summary=VALUES(summary),
         category=VALUES(category), priority=VALUES(priority), received_at=VALUES(received_at), tags=VALUES(tags)`,
      {
        id: `mailg_${e.gid}`.slice(0, 40),
        t: tenantId,
        from: e.from.slice(0, 160),
        subj: e.subject.slice(0, 255),
        sum: (t?.summary || e.snippet).slice(0, 1000),
        cat: t?.category ?? categorize(`${e.subject} ${e.snippet}`),
        pri: t?.priority ?? 'med',
        rcv: ymd(e.received),
        tags: JSON.stringify(t?.tags ?? []),
      },
    );
  }
  return { imported: emails.length, detail: `${emails.length} messages` };
}

/** Sends an email via Gmail (used for approved "Draft email" delivery). */
export async function gmailSend(tenantId: string, to: string, subject: string, body: string): Promise<void> {
  const raw = [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8', '', body].join('\r\n');
  const encoded = Buffer.from(raw, 'utf8').toString('base64url');
  await googleClient.post(tenantId, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    raw: encoded,
  });
}

// ── Calendar ──────────────────────────────────────────────────────────────────
interface CalList {
  items?: {
    id: string;
    summary?: string;
    location?: string;
    description?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
    attendees?: unknown[];
  }[];
}

export async function syncCalendar(tenantId: string, userId: string): Promise<SyncResult> {
  const timeMin = new Date().toISOString();
  const data = await googleClient.get<CalList>(
    tenantId,
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=20&singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}`,
  );
  let imported = 0;
  for (const e of data.items ?? []) {
    const startRaw = e.start?.dateTime ?? e.start?.date;
    const endRaw = e.end?.dateTime ?? e.end?.date;
    if (!startRaw) continue;
    const start = new Date(startRaw);
    const end = endRaw ? new Date(endRaw) : new Date(start.getTime() + 30 * 60_000);
    await execute(
      `INSERT INTO calendar_events (id, tenant_id, user_id, title, start_at, end_at, color, location, notes, attendees, source, google_event_id)
       VALUES (:id, :t, :u, :title, :s, :e, '#2a6fdb', :loc, :notes, :att, 'gcalendar', :gid)
       ON DUPLICATE KEY UPDATE title=VALUES(title), start_at=VALUES(start_at), end_at=VALUES(end_at),
         location=VALUES(location), notes=VALUES(notes), attendees=VALUES(attendees), google_event_id=VALUES(google_event_id)`,
      {
        id: `evtg_${e.id}`.slice(0, 40),
        t: tenantId,
        u: userId,
        title: (e.summary ?? '(untitled)').slice(0, 255),
        s: dt(start),
        e: dt(end),
        loc: (e.location ?? '').slice(0, 160) || null,
        notes: (e.description ?? '').slice(0, 1000) || null,
        att: Array.isArray(e.attendees) ? e.attendees.length : 0,
        gid: e.id ?? null,
      },
    );
    imported++;
  }
  return { imported, detail: `${imported} events` };
}

// ── Drive / Sheets (read + count; verifies access) ──────────────────────────────
interface DriveList {
  files?: { id: string; name: string; mimeType: string }[];
}
export async function syncDrive(tenantId: string): Promise<SyncResult> {
  const qs = new URLSearchParams({
    pageSize: '20',
    orderBy: 'modifiedTime desc',
    fields: 'files(id,name,mimeType)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'allDrives',
  }).toString();
  const data = await googleClient.get<DriveList>(tenantId, `https://www.googleapis.com/drive/v3/files?${qs}`);
  return { imported: data.files?.length ?? 0, detail: `${data.files?.length ?? 0} files` };
}
export async function syncSheets(tenantId: string): Promise<SyncResult> {
  const qs = new URLSearchParams({
    pageSize: '20',
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: 'files(id,name,mimeType)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'allDrives',
  }).toString();
  const data = await googleClient.get<DriveList>(tenantId, `https://www.googleapis.com/drive/v3/files?${qs}`);
  return { imported: data.files?.length ?? 0, detail: `${data.files?.length ?? 0} sheets` };
}
