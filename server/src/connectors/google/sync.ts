import { execute } from '../../db/pool.js';
import { googleClient } from './client.js';

export interface SyncResult {
  imported: number;
  detail: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dt = (d: Date) =>
  `${ymd(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

/** Lightweight category heuristic until the Mail-AI classifier runs. */
function categorize(text: string): string {
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
interface GmailMessage {
  id: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[] };
}

export async function syncGmail(tenantId: string): Promise<SyncResult> {
  const list = await googleClient.get<GmailList>(
    tenantId,
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15&q=newer_than:30d',
  );
  const ids = (list.messages ?? []).slice(0, 15);
  let imported = 0;
  for (const { id: gid } of ids) {
    const msg = await googleClient.get<GmailMessage>(
      tenantId,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gid}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    );
    const headers = msg.payload?.headers ?? [];
    const from = headerValue(headers, 'From');
    const subject = headerValue(headers, 'Subject') || '(no subject)';
    const snippet = msg.snippet ?? '';
    const received = msg.internalDate ? new Date(Number(msg.internalDate)) : new Date();
    await execute(
      `INSERT INTO mail_items (id, tenant_id, from_name, subject, summary, category, priority, received_at, tags)
       VALUES (:id, :t, :from, :subj, :sum, :cat, 'med', :rcv, JSON_ARRAY())
       ON DUPLICATE KEY UPDATE from_name=VALUES(from_name), subject=VALUES(subject), summary=VALUES(summary), category=VALUES(category), received_at=VALUES(received_at)`,
      {
        id: `mailg_${gid}`.slice(0, 40),
        t: tenantId,
        from: displayName(from).slice(0, 160),
        subj: subject.slice(0, 255),
        sum: snippet.slice(0, 1000),
        cat: categorize(`${subject} ${snippet}`),
        rcv: ymd(received),
      },
    );
    imported++;
  }
  return { imported, detail: `${imported} messages` };
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
      `INSERT INTO calendar_events (id, tenant_id, user_id, title, start_at, end_at, color, location, notes, attendees, source)
       VALUES (:id, :t, :u, :title, :s, :e, '#2a6fdb', :loc, :notes, :att, 'gcalendar')
       ON DUPLICATE KEY UPDATE title=VALUES(title), start_at=VALUES(start_at), end_at=VALUES(end_at), location=VALUES(location), notes=VALUES(notes)`,
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
  const data = await googleClient.get<DriveList>(
    tenantId,
    'https://www.googleapis.com/drive/v3/files?pageSize=20&orderBy=modifiedTime%20desc&fields=files(id,name,mimeType)',
  );
  return { imported: data.files?.length ?? 0, detail: `${data.files?.length ?? 0} files` };
}
export async function syncSheets(tenantId: string): Promise<SyncResult> {
  const data = await googleClient.get<DriveList>(
    tenantId,
    "https://www.googleapis.com/drive/v3/files?pageSize=20&q=mimeType%3D'application%2Fvnd.google-apps.spreadsheet'&fields=files(id,name,mimeType)",
  );
  return { imported: data.files?.length ?? 0, detail: `${data.files?.length ?? 0} sheets` };
}
