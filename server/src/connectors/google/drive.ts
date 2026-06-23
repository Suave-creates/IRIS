import type { AvailableSource } from '@iris/shared';
import { googleClient } from './client.js';

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

const MAX_CONTENT = 8_000;

/** Lists real Drive items of a given type for the user to pick as a project source. */
export async function listDriveSources(tenantId: string, type: SourceType): Promise<AvailableSource[]> {
  const q = encodeURIComponent(`mimeType='${MIME[type]}' and trashed=false`);
  const data = await googleClient.get<DriveListResp>(
    tenantId,
    `https://www.googleapis.com/drive/v3/files?pageSize=25&orderBy=modifiedTime%20desc&q=${q}&fields=files(id,name,mimeType,webViewLink)`,
  );
  return (data.files ?? []).map((f) => ({
    externalId: f.id,
    name: f.name,
    type,
    webLink: f.webViewLink ?? null,
  }));
}

/** Reads the text content of a linked source (doc export / sheet values / folder listing). */
export async function readSourceContent(tenantId: string, type: SourceType, externalId: string): Promise<string> {
  if (type === 'doc') {
    const text = await googleClient.getText(
      tenantId,
      `https://www.googleapis.com/drive/v3/files/${externalId}/export?mimeType=text/plain`,
    );
    return text.slice(0, MAX_CONTENT);
  }

  if (type === 'sheet') {
    const data = await googleClient.get<{ values?: string[][] }>(
      tenantId,
      `https://sheets.googleapis.com/v4/spreadsheets/${externalId}/values/A1:Z80`,
    );
    const rows = (data.values ?? []).map((r) => r.join(' | '));
    return rows.join('\n').slice(0, MAX_CONTENT);
  }

  // folder → list children, read a couple of docs/sheets, concatenate.
  const q = encodeURIComponent(`'${externalId}' in parents and trashed=false`);
  const listing = await googleClient.get<DriveListResp>(
    tenantId,
    `https://www.googleapis.com/drive/v3/files?pageSize=25&q=${q}&fields=files(id,name,mimeType)`,
  );
  const files = listing.files ?? [];
  const names = files.map((f) => `- ${f.name}`).join('\n');
  let body = `Folder contents:\n${names}\n`;
  const readable = files
    .filter((f) => f.mimeType === MIME.doc || f.mimeType === MIME.sheet)
    .slice(0, 2);
  for (const f of readable) {
    const t: SourceType = f.mimeType === MIME.doc ? 'doc' : 'sheet';
    const text = await readSourceContent(tenantId, t, f.id);
    body += `\n--- ${f.name} ---\n${text.slice(0, 3000)}\n`;
    if (body.length > MAX_CONTENT) break;
  }
  return body.slice(0, MAX_CONTENT);
}
