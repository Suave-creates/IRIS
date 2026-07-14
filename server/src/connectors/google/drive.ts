import * as XLSX from 'xlsx';
import type { AvailableSource } from '@iris/shared';
import { googleClient } from './client.js';

/** Uploaded-Excel MIME types (NOT Google Sheets) — read by downloading + parsing bytes. */
export const XLSX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
]);
export const isXlsxMime = (mime: string | null | undefined): boolean => !!mime && XLSX_MIMES.has(mime);

type SourceType = 'folder' | 'sheet' | 'doc';

const MIME: Record<SourceType, string> = {
  folder: 'application/vnd.google-apps.folder',
  doc: 'application/vnd.google-apps.document',
  sheet: 'application/vnd.google-apps.spreadsheet',
};

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
}
interface DriveListResp {
  files?: DriveFile[];
}

// Generous cap so multi-project trackers (one row per project) aren't truncated
// before the AI sees every row.
const MAX_CONTENT = 24_000;

/** Builds a Drive files.list URL with every param URL-encoded (survives proxies). */
function driveListUrl(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `https://www.googleapis.com/drive/v3/files?${qs}`;
}

/** Lists real Drive items of a given type for the user to pick as a project source. */
export async function listDriveSources(tenantId: string, type: SourceType): Promise<AvailableSource[]> {
  const data = await googleClient.get<DriveListResp>(
    tenantId,
    driveListUrl({
      pageSize: '50',
      orderBy: 'modifiedTime desc',
      q: `mimeType='${MIME[type]}' and trashed=false`,
      fields: 'files(id,name,mimeType,webViewLink)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      corpora: 'allDrives',
    }),
  );
  return (data.files ?? []).map((f) => ({
    externalId: f.id,
    name: f.name?.trim() || 'Untitled',
    type,
    webLink: f.webViewLink ?? null,
  }));
}

/** A Drive file someone shared with the signed-in user. */
export interface SharedDriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
  /** When it was shared (ISO), else the last modification. */
  sharedAt: string | null;
}

interface SharedListResp {
  files?: (DriveFile & { sharedWithMeTime?: string; modifiedTime?: string })[];
}

/**
 * Files a specific person has shared with the signed-in user (they own the
 * file and it sits in the user's "Shared with me"), newest share first.
 */
export async function listFilesSharedBy(tenantId: string, email: string, pageSize = 15): Promise<SharedDriveFile[]> {
  // The Drive query wraps the email in single quotes — strip quote/backslash
  // characters so crafted addresses cannot alter the query.
  const safe = email.replace(/['\\]/g, '').trim();
  if (!safe) return [];
  const data = await googleClient.get<SharedListResp>(
    tenantId,
    driveListUrl({
      pageSize: String(pageSize),
      orderBy: 'sharedWithMeTime desc',
      q: `sharedWithMe = true and '${safe}' in owners and trashed = false`,
      fields: 'files(id,name,mimeType,webViewLink,sharedWithMeTime,modifiedTime)',
    }),
  );
  return (data.files ?? []).map((f) => ({
    id: f.id,
    name: f.name?.trim() || 'Untitled',
    mimeType: f.mimeType,
    webViewLink: f.webViewLink ?? null,
    sharedAt: f.sharedWithMeTime ?? f.modifiedTime ?? null,
  }));
}

/**
 * Patterns that extract a Drive/Docs/Sheets file ID from a pasted URL.
 * The optional `(?:u/N/)?` segment covers account-scoped links copied from the
 * browser address bar when signed into multiple Google accounts
 * (e.g. docs.google.com/spreadsheets/u/0/d/<id>/edit).
 */
const REF_PATTERNS = [
  /\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/,
  /\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/,
  /\/presentation\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/,
  /\/file\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/,
  /\/folders\/([A-Za-z0-9_-]+)/,
  /[?&]id=([A-Za-z0-9_-]+)/,
];

/** Extracts a Drive file/folder ID from a pasted URL, or returns a bare ID as-is. */
export function parseDriveRef(ref: string): string | null {
  const s = ref.trim();
  if (!s) return null;
  for (const p of REF_PATTERNS) {
    const m = s.match(p);
    if (m?.[1]) return m[1];
  }
  // Bare ID (Drive IDs are long base64url-ish strings).
  if (/^[A-Za-z0-9_-]{15,}$/.test(s)) return s;
  return null;
}

const DEFAULT_LINK: Record<SourceType, (id: string) => string> = {
  sheet: (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`,
  doc: (id) => `https://docs.google.com/document/d/${id}/edit`,
  folder: (id) => `https://drive.google.com/drive/folders/${id}`,
};

/**
 * Resolves a single Drive item's real title from its ID (best effort).
 * Uses the per-file metadata endpoint (more reliable than list behind proxies);
 * falls back to the Sheets API title, then to a typed placeholder name.
 */
export async function resolveDriveItem(
  tenantId: string,
  type: SourceType,
  externalId: string,
): Promise<AvailableSource> {
  const fallback: AvailableSource = {
    externalId,
    name: `Untitled ${type}`,
    type,
    webLink: DEFAULT_LINK[type](externalId),
  };

  try {
    const qs = new URLSearchParams({
      fields: 'id,name,mimeType,webViewLink',
      supportsAllDrives: 'true',
    }).toString();
    const f = await googleClient.get<DriveFile>(
      tenantId,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(externalId)}?${qs}`,
    );
    const name = f.name?.trim();
    if (name) return { externalId: f.id || externalId, name, type, webLink: f.webViewLink ?? fallback.webLink };
  } catch {
    /* fall through to type-specific fallback */
  }

  if (type === 'sheet') {
    try {
      const qs = new URLSearchParams({ fields: 'properties.title', includeGridData: 'false' }).toString();
      const s = await googleClient.get<{ properties?: { title?: string } }>(
        tenantId,
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(externalId)}?${qs}`,
      );
      const title = s.properties?.title?.trim();
      if (title) return { externalId, name: title, type, webLink: fallback.webLink };
    } catch {
      /* fall through */
    }
  }

  return fallback;
}

/** One tab (worksheet) of a spreadsheet: its title + raw cell grid. */
export interface SheetTab {
  title: string;
  values: string[][];
  /**
   * Per-cell person/smart-chip email, parallel to `values` (null where a cell has
   * no chip). Only populated by the rich read — a `@name` person chip renders as a
   * plain name in `values`, so its underlying email is captured here.
   */
  chipEmails?: (string | null)[][];
}

/** Max worksheets read from one spreadsheet (bounds cost on huge workbooks). */
const MAX_TABS = 20;

/** A1-notation range for a tab, single-quoting + escaping the title (handles spaces/quotes). */
function tabRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'!A1:AZ500`;
}

/**
 * Reads EVERY worksheet tab of a spreadsheet, not just the first.
 * Enumerates tab titles, then batch-gets all their grids in one request.
 */
export async function readSheetTabs(tenantId: string, externalId: string): Promise<SheetTab[]> {
  const idEnc = encodeURIComponent(externalId);

  // 1) Enumerate the grid tabs.
  const metaQs = new URLSearchParams({ fields: 'sheets.properties(title,sheetType)' }).toString();
  const meta = await googleClient.get<{ sheets?: { properties?: { title?: string; sheetType?: string } }[] }>(
    tenantId,
    `https://sheets.googleapis.com/v4/spreadsheets/${idEnc}?${metaQs}`,
  );
  const titles = (meta.sheets ?? [])
    .map((s) => s.properties)
    .filter((p) => !p?.sheetType || p.sheetType === 'GRID')
    .map((p) => p?.title?.trim())
    .filter((t): t is string => !!t)
    .slice(0, MAX_TABS);
  if (titles.length === 0) return [];

  // 2) Batch-get the values of every tab (valueRanges come back in request order).
  const params = new URLSearchParams({ majorDimension: 'ROWS', valueRenderOption: 'FORMATTED_VALUE' });
  for (const t of titles) params.append('ranges', tabRange(t));
  const data = await googleClient.get<{ valueRanges?: { values?: unknown[][] }[] }>(
    tenantId,
    `https://sheets.googleapis.com/v4/spreadsheets/${idEnc}/values:batchGet?${params.toString()}`,
  );
  const ranges = data.valueRanges ?? [];
  return titles.map((title, i) => ({
    title,
    values: (ranges[i]?.values ?? []).map((row) => row.map((c) => (c == null ? '' : String(c)))),
  }));
}

// Shapes for the grid-data read that carries person/smart-chip metadata.
interface ChipCell {
  formattedValue?: string;
  chipRuns?: { chip?: { personProperties?: { email?: string } } }[];
}
interface RichSheetObj {
  properties?: { title?: string };
  data?: { rowData?: { values?: ChipCell[] }[] }[];
}

/** First person-chip email in a cell (Sheets smart chips can hold several), else null. */
function cellChipEmail(cell: ChipCell): string | null {
  const email = cell.chipRuns?.map((r) => r.chip?.personProperties?.email).find((e) => !!e);
  return email ? email.trim() : null;
}

/**
 * Like readSheetTabs, but reads the grid via spreadsheets.get so each cell's
 * person/smart-chip email is captured alongside its displayed text. A `@name`
 * stakeholder chip shows as a plain name in `values` (identical to the values
 * read) while its email lands in `chipEmails` at the same [row][col].
 */
export async function readSheetTabsRich(tenantId: string, externalId: string): Promise<SheetTab[]> {
  const idEnc = encodeURIComponent(externalId);

  // 1) Enumerate the grid tabs (same as readSheetTabs).
  const metaQs = new URLSearchParams({ fields: 'sheets.properties(title,sheetType)' }).toString();
  const meta = await googleClient.get<{ sheets?: { properties?: { title?: string; sheetType?: string } }[] }>(
    tenantId,
    `https://sheets.googleapis.com/v4/spreadsheets/${idEnc}?${metaQs}`,
  );
  const titles = (meta.sheets ?? [])
    .map((s) => s.properties)
    .filter((p) => !p?.sheetType || p.sheetType === 'GRID')
    .map((p) => p?.title?.trim())
    .filter((t): t is string => !!t)
    .slice(0, MAX_TABS);
  if (titles.length === 0) return [];

  // 2) One grid-data read, bounded to the same A1:AZ500 window per tab, with a
  //    tight fields mask (formatted text + chip email only) to keep it lean.
  const params = new URLSearchParams({ includeGridData: 'true' });
  for (const t of titles) params.append('ranges', tabRange(t));
  params.append(
    'fields',
    'sheets(properties(title),data(rowData(values(formattedValue,chipRuns(chip(personProperties(email)))))))',
  );
  const grid = await googleClient.get<{ sheets?: RichSheetObj[] }>(
    tenantId,
    `https://sheets.googleapis.com/v4/spreadsheets/${idEnc}?${params.toString()}`,
  );
  const byTitle = new Map<string, RichSheetObj>();
  for (const s of grid.sheets ?? []) {
    const t = s.properties?.title?.trim();
    if (t) byTitle.set(t, s);
  }

  return titles.map((title) => {
    const rows = byTitle.get(title)?.data?.[0]?.rowData ?? [];
    const values: string[][] = [];
    const chipEmails: (string | null)[][] = [];
    for (const r of rows) {
      const cells = r.values ?? [];
      values.push(cells.map((c) => (c.formattedValue == null ? '' : String(c.formattedValue))));
      chipEmails.push(cells.map(cellChipEmail));
    }
    return { title, values, chipEmails };
  });
}

/** Flattens all tabs of a sheet into a single labeled text block (for AI text context). */
export async function readSheetText(tenantId: string, externalId: string, maxChars = MAX_CONTENT): Promise<string> {
  const tabs = await readSheetTabs(tenantId, externalId);
  const text = tabs
    .map((t) => `## Tab: ${t.title}\n${t.values.map((r) => r.join(' | ')).join('\n')}`)
    .join('\n\n');
  return text.slice(0, maxChars);
}

/** The MIME type of a Drive file (used to route Google-Sheet vs uploaded-Excel reads). */
export async function getMimeType(tenantId: string, externalId: string): Promise<string | null> {
  const qs = new URLSearchParams({ fields: 'mimeType', supportsAllDrives: 'true' }).toString();
  const f = await googleClient.get<{ mimeType?: string }>(
    tenantId,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(externalId)}?${qs}`,
  );
  return f.mimeType ?? null;
}

/** Reads EVERY worksheet of an uploaded .xlsx/.xls by downloading the bytes and parsing them. */
export async function readXlsxTabs(tenantId: string, externalId: string): Promise<SheetTab[]> {
  const buf = await googleClient.getBuffer(
    tenantId,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(externalId)}?alt=media&supportsAllDrives=true`,
  );
  const wb = XLSX.read(buf, { type: 'buffer' });
  return wb.SheetNames.slice(0, MAX_TABS).map((name) => {
    const ws = wb.Sheets[name];
    const rows = ws ? XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '' }) : [];
    return {
      title: name,
      values: rows.map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? '' : String(c))) : [])),
    };
  });
}

/** Flattens an uploaded Excel workbook into labeled text (all sheets), for AI context. */
export async function readXlsxText(tenantId: string, externalId: string, maxChars = 50_000): Promise<string> {
  const tabs = await readXlsxTabs(tenantId, externalId);
  return tabs
    .map((t) => `## Tab: ${t.title}\n${t.values.map((r) => r.join(' | ')).join('\n')}`)
    .join('\n\n')
    .slice(0, maxChars);
}

/** Extracts the worksheet gid from a Google Sheets URL (e.g. ...#gid=1937180792). */
export function parseDriveGid(ref: string): string | null {
  return ref.match(/[#?&]gid=([0-9]+)/)?.[1] ?? null;
}

/** Reads ONE worksheet (selected by gid) in full — the whole used range, all columns. */
export async function readSheetTabByGid(tenantId: string, externalId: string, gid: string): Promise<SheetTab | null> {
  const idEnc = encodeURIComponent(externalId);
  const metaQs = new URLSearchParams({ fields: 'sheets.properties(title,sheetId,sheetType)' }).toString();
  const meta = await googleClient.get<{
    sheets?: { properties?: { title?: string; sheetId?: number; sheetType?: string } }[];
  }>(tenantId, `https://sheets.googleapis.com/v4/spreadsheets/${idEnc}?${metaQs}`);
  const want = Number(gid);
  const match = (meta.sheets ?? [])
    .map((s) => s.properties)
    .find((p) => p?.sheetId === want && (!p?.sheetType || p.sheetType === 'GRID'));
  const title = match?.title?.trim();
  if (!title) return null;
  // A bare quoted sheet name returns the whole used range of that tab (all columns).
  const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'`);
  const data = await googleClient.get<{ values?: unknown[][] }>(
    tenantId,
    `https://sheets.googleapis.com/v4/spreadsheets/${idEnc}/values/${range}`,
  );
  return { title, values: (data.values ?? []).map((row) => row.map((c) => (c == null ? '' : String(c)))) };
}

/**
 * Text for AI context: if a gid is given, the single targeted tab in full;
 * otherwise every tab (bounded). Honors a pasted "#gid=" so a huge workbook
 * resolves to exactly the tab the user pointed at.
 */
export async function readSheetTextForRef(
  tenantId: string,
  externalId: string,
  gid: string | null,
  maxChars = 50_000,
): Promise<string> {
  if (gid) {
    const tab = await readSheetTabByGid(tenantId, externalId, gid);
    if (tab) {
      return `## Tab: ${tab.title}\n${tab.values.map((r) => r.join(' | ')).join('\n')}`.slice(0, maxChars);
    }
  }
  return readSheetText(tenantId, externalId, maxChars);
}

/** Reads the text content of a linked source (doc export / sheet values / folder listing). */
export async function readSourceContent(tenantId: string, type: SourceType, externalId: string): Promise<string> {
  // IDs are interpolated into authenticated Google URLs — always encode.
  const idEnc = encodeURIComponent(externalId);

  if (type === 'doc') {
    const text = await googleClient.getText(
      tenantId,
      `https://www.googleapis.com/drive/v3/files/${idEnc}/export?mimeType=text/plain`,
    );
    return text.slice(0, MAX_CONTENT);
  }

  if (type === 'sheet') {
    return readSheetText(tenantId, externalId);
  }

  // folder → list children, read a couple of docs/sheets, concatenate.
  // externalId is charset-constrained at the validation boundary, so the
  // single-quoted `q` predicate cannot be broken out of.
  const listing = await googleClient.get<DriveListResp>(
    tenantId,
    driveListUrl({
      pageSize: '25',
      q: `'${externalId}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      corpora: 'allDrives',
    }),
  );
  const files = listing.files ?? [];
  const names = files.map((f) => `- ${f.name}`).join('\n');
  let body = `Folder contents:\n${names}\n`;
  // Read Google Docs/Sheets AND uploaded Excel children. Larger budget than a single
  // doc since a folder of data files (e.g. RCA workbooks) is the point of linking it.
  const FOLDER_MAX = 48_000;
  const readable = files
    .filter((f) => f.mimeType === MIME.doc || f.mimeType === MIME.sheet || isXlsxMime(f.mimeType))
    .slice(0, 6);
  for (const f of readable) {
    try {
      const text = isXlsxMime(f.mimeType)
        ? await readXlsxText(tenantId, f.id, 16_000)
        : f.mimeType === MIME.doc
          ? await readSourceContent(tenantId, 'doc', f.id)
          : await readSheetText(tenantId, f.id, 16_000);
      body += `\n--- ${f.name} ---\n${text}\n`;
    } catch {
      // One inaccessible child shouldn't fail the whole folder scan.
      body += `\n--- ${f.name} (could not read) ---\n`;
    }
    if (body.length > FOLDER_MAX) break;
  }
  return body.slice(0, FOLDER_MAX);
}

/**
 * Reads a spreadsheet's tabs whether it's a Google Sheet or an uploaded .xlsx/.xls.
 * Google Sheets use the rich read so stakeholder person-chip emails come through
 * (`chipEmails`); uploaded Excel has no smart chips, so its `chipEmails` stay unset.
 */
export async function readSpreadsheetTabs(tenantId: string, externalId: string): Promise<SheetTab[]> {
  let mime: string | null = null;
  try {
    mime = await getMimeType(tenantId, externalId);
  } catch {
    /* default to Google Sheet path */
  }
  return isXlsxMime(mime) ? readXlsxTabs(tenantId, externalId) : readSheetTabsRich(tenantId, externalId);
}

/**
 * Spreadsheet text for AI context, routed by type: a gid-targeted Google Sheet tab,
 * an uploaded Excel workbook (all sheets), or a full Google Sheet (all tabs).
 */
export async function readSpreadsheetText(
  tenantId: string,
  externalId: string,
  gid: string | null,
  maxChars = 50_000,
): Promise<string> {
  if (gid) return readSheetTextForRef(tenantId, externalId, gid, maxChars);
  let mime: string | null = null;
  try {
    mime = await getMimeType(tenantId, externalId);
  } catch {
    /* default to Google Sheet path */
  }
  return isXlsxMime(mime) ? readXlsxText(tenantId, externalId, maxChars) : readSheetText(tenantId, externalId, maxChars);
}
