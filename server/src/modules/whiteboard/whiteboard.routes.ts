import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { WhiteboardItem, WhiteboardKind } from '@iris/shared';
import { currentUser, requireAuth } from '../auth/guards.js';
import { Errors } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { googleClient } from '../../connectors/google/client.js';
import {
  parseDriveGid,
  parseDriveRef,
  readSourceContent,
  readSpreadsheetText,
  resolveDriveItem,
} from '../../connectors/google/drive.js';
import { whiteboardRepo } from './whiteboard.repo.js';
import { runWhiteboardAi, type AiFile } from './whiteboard.ai.js';

const fileKind = z.enum(['folder', 'sheet', 'doc']);
const driveId = z.string().trim().regex(/^[A-Za-z0-9_-]+$/, 'Invalid Drive ID.').min(1).max(255);

const addItemSchema = z.object({
  kind: fileKind,
  externalId: driveId,
  title: z.string().trim().min(1).max(255),
  webLink: z.string().trim().max(512).nullish(),
  x: z.number().int().min(0).max(20_000).optional(),
  y: z.number().int().min(0).max(20_000).optional(),
});

const addByRefSchema = z.object({
  kind: fileKind,
  ref: z.string().trim().min(1).max(1024),
  x: z.number().int().min(0).max(20_000).optional(),
  y: z.number().int().min(0).max(20_000).optional(),
});

const updateItemSchema = z.object({
  x: z.number().int().min(0).max(20_000).optional(),
  y: z.number().int().min(0).max(20_000).optional(),
  w: z.number().int().min(140).max(1600).optional(),
  h: z.number().int().min(120).max(1400).optional(),
  z: z.number().int().min(0).max(100_000).optional(),
  aiIncluded: z.boolean().optional(),
  title: z.string().trim().min(1).max(255).optional(),
});

const aiSchema = z.object({
  action: z.enum(['summarize', 'reconcile', 'board', 'custom']),
  prompt: z.string().trim().max(2000).optional(),
});

const idParams = z.object({ id: z.string().min(1) });

/** Default window footprint per kind, mirroring the prototype. */
const DEFAULT_SIZE: Record<WhiteboardKind, { w: number; h: number }> = {
  sheet: { w: 300, h: 210 },
  doc: { w: 286, h: 236 },
  folder: { w: 300, h: 210 },
  pdf: { w: 280, h: 220 },
  slide: { w: 330, h: 206 },
  insight: { w: 470, h: 400 },
};

const MAX_AI_FILES = 8;

/** Reads the text content of one connector-backed window for AI context. */
async function readItemContent(tenantId: string, item: WhiteboardItem): Promise<string> {
  if (item.kind === 'insight') return item.body ?? '';
  if (!item.externalId) return '';
  if (item.kind === 'sheet') {
    // A "#gid=" preserved on the web link targets the exact tab. Otherwise the file may
    // be a Google Sheet OR an uploaded .xlsx — readSpreadsheetText routes by type.
    const gid = item.webLink ? parseDriveGid(item.webLink) : null;
    return readSpreadsheetText(tenantId, item.externalId, gid);
  }
  if (item.kind === 'doc' || item.kind === 'folder') {
    return readSourceContent(tenantId, item.kind, item.externalId);
  }
  return '';
}

export async function whiteboardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // Full canvas for the current user.
  app.get('/', async (req) => {
    const me = currentUser(req);
    return { data: await whiteboardRepo.list(me.tenantId, me.id) };
  });

  // Add a known connector file (chosen from the linked-sources library).
  app.post('/items', async (req, reply) => {
    const me = currentUser(req);
    const body = addItemSchema.parse(req.body);
    const size = DEFAULT_SIZE[body.kind];
    const item = await whiteboardRepo.create(me.tenantId, me.id, {
      kind: body.kind,
      title: body.title,
      externalId: body.externalId,
      webLink: body.webLink ?? null,
      x: body.x ?? 40,
      y: body.y ?? 40,
      w: size.w,
      h: size.h,
      aiIncluded: true,
      body: null,
    });
    reply.code(201);
    return { data: item };
  });

  // Add a file by pasted Google URL or ID (resolves the real title).
  app.post('/items/by-ref', async (req, reply) => {
    const me = currentUser(req);
    const body = addByRefSchema.parse(req.body);
    if (!(await googleClient.isConnected(me.tenantId))) {
      throw Errors.upstream('Google is not connected.', 'Connect Google on the Connectors page to add real files.');
    }
    const externalId = parseDriveRef(body.ref);
    if (!externalId) {
      throw Errors.validation('Could not find a Google Drive ID in that link. Paste a full URL or the file ID.');
    }
    const resolved = await resolveDriveItem(me.tenantId, body.kind, externalId);
    // Preserve the pasted URL (with its #gid=) so we can target that exact tab later.
    const gid = parseDriveGid(body.ref);
    const webLink = gid && /^https?:\/\//i.test(body.ref) ? body.ref.slice(0, 512) : resolved.webLink;
    const size = DEFAULT_SIZE[body.kind];
    const item = await whiteboardRepo.create(me.tenantId, me.id, {
      kind: body.kind,
      title: resolved.name,
      externalId: resolved.externalId,
      webLink,
      x: body.x ?? 40,
      y: body.y ?? 40,
      w: size.w,
      h: size.h,
      aiIncluded: true,
      body: null,
    });
    reply.code(201);
    return { data: item };
  });

  // Drag / resize / AI toggle / rename.
  app.patch('/items/:id', async (req) => {
    const me = currentUser(req);
    const { id } = idParams.parse(req.params);
    const patch = updateItemSchema.parse(req.body);
    const updated = await whiteboardRepo.update(me.tenantId, me.id, id, patch);
    if (!updated) throw Errors.notFound('Whiteboard item not found.');
    return { data: updated };
  });

  app.delete('/items/:id', async (req) => {
    const me = currentUser(req);
    const { id } = idParams.parse(req.params);
    const ok = await whiteboardRepo.remove(me.tenantId, me.id, id);
    if (!ok) throw Errors.notFound('Whiteboard item not found.');
    return { data: { ok: true } };
  });

  // Cross-file AI: read every AI-included file, reason across them, persist an insight window.
  app.post('/ai', async (req) => {
    const me = currentUser(req);
    const body = aiSchema.parse(req.body);
    if (body.action === 'custom' && !body.prompt?.trim()) {
      throw Errors.validation('Enter a prompt for Claude.');
    }

    const all = await whiteboardRepo.list(me.tenantId, me.id);
    const included = all.filter((i) => i.aiIncluded).slice(0, MAX_AI_FILES);
    if (included.length === 0) {
      throw Errors.validation('Add a file to Claude’s context first (toggle "AI" on a window).');
    }

    // Reading connector files needs Google connected.
    if (included.some((i) => i.externalId) && !(await googleClient.isConnected(me.tenantId))) {
      throw Errors.upstream('Google is not connected.', 'Connect Google to let IRIS read these files.');
    }

    const files: AiFile[] = [];
    for (const item of included) {
      try {
        files.push({ title: item.title, kind: item.kind, content: await readItemContent(me.tenantId, item) });
      } catch (err) {
        logger.warn({ err, item: item.title }, 'whiteboard AI: failed to read a file');
        files.push({ title: item.title, kind: item.kind, content: '(could not read this file)' });
      }
    }

    const artifact = await runWhiteboardAi(body.action, body.prompt ?? null, files);
    const size = DEFAULT_SIZE.insight;
    const insight = await whiteboardRepo.create(me.tenantId, me.id, {
      kind: 'insight',
      title: artifact.title,
      externalId: null,
      webLink: null,
      x: 70,
      y: 56,
      w: size.w,
      h: size.h,
      aiIncluded: false,
      body: JSON.stringify(artifact),
    });
    logger.info({ action: body.action, files: files.length, blocks: artifact.blocks.length }, 'whiteboard AI insight created');
    return { data: insight };
  });
}
