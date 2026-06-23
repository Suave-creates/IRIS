import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser, requireAuth } from '../auth/guards.js';
import { Errors } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { googleClient } from '../../connectors/google/client.js';
import {
  listDriveSources,
  parseDriveRef,
  readSheetValues,
  readSourceContent,
  resolveDriveItem,
} from '../../connectors/google/drive.js';
import { projectsRepo } from './projects.repo.js';
import { extractProjects, extractProjectsFromSheet, summarizeManual } from './projects.ai.js';

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  priority: z.enum(['critical', 'high', 'med', 'low']),
  deadline: z.string().trim().max(40).nullish(),
  description: z.string().trim().max(2000).nullish(),
});

const linkSourceSchema = z.object({
  type: z.enum(['folder', 'sheet', 'doc']),
  // Drive/Docs/Sheets IDs are base64url — constrain so it can't inject into upstream URLs.
  externalId: z.string().trim().regex(/^[A-Za-z0-9_-]+$/, 'Invalid Drive ID.').min(1).max(255),
  name: z.string().trim().min(1).max(200),
  webLink: z.string().trim().max(512).nullish(),
});

const linkByRefSchema = z.object({
  type: z.enum(['folder', 'sheet', 'doc']),
  ref: z.string().trim().min(1).max(1024),
});

const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  priority: z.enum(['critical', 'high', 'med', 'low']).optional(),
  deadline: z.string().trim().max(40).nullable().optional(),
  status: z.string().trim().min(1).max(40).optional(),
  owner: z.string().trim().min(1).max(160).optional(),
  summary: z.string().trim().max(2000).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  currentStage: z.number().int().min(0).max(20).optional(),
});

const fieldSchema = z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().max(200) });
const addTaskSchema = z.object({ title: z.string().trim().min(1).max(255) });
const updateTaskSchema = z.object({ title: z.string().trim().min(1).max(255).optional(), done: z.boolean().optional() });
const idParams = z.object({ id: z.string().min(1) });
const taskParams = z.object({ id: z.string().min(1), taskId: z.string().min(1) });
const fieldParams = z.object({ id: z.string().min(1), fieldId: z.string().min(1) });

const MAX_FETCH_SOURCES = 6;

export async function projectsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // ── Sources ─────────────────────────────────────────────────────────────
  app.get('/sources', async (req) => {
    const me = currentUser(req);
    return { data: await projectsRepo.listSources(me.tenantId) };
  });

  // Live Drive items to pick from (folder | doc | sheet).
  app.get('/sources/available', async (req) => {
    const me = currentUser(req);
    const { type } = z.object({ type: z.enum(['folder', 'sheet', 'doc']) }).parse(req.query);
    if (!(await googleClient.isConnected(me.tenantId))) {
      throw Errors.upstream('Google is not connected.', 'Connect Google on the Connectors page to link real sources.');
    }
    const items = await listDriveSources(me.tenantId, type);
    logger.info({ type, count: items.length, sample: items[0]?.name }, 'drive sources listed');
    return { data: items };
  });

  // Link a real connector item as a source.
  app.post('/sources', async (req) => {
    const me = currentUser(req);
    const body = linkSourceSchema.parse(req.body);
    return { data: await projectsRepo.createSourceLinked(me.tenantId, body) };
  });

  // Link by pasted URL or ID — resolves the real title even when listing is blocked.
  app.post('/sources/by-ref', async (req) => {
    const me = currentUser(req);
    const { type, ref } = linkByRefSchema.parse(req.body);
    if (!(await googleClient.isConnected(me.tenantId))) {
      throw Errors.upstream('Google is not connected.', 'Connect Google on the Connectors page to link real sources.');
    }
    const externalId = parseDriveRef(ref);
    if (!externalId) {
      throw Errors.validation(
        'Could not find a Google Drive ID in that link. Paste a full Google Sheets/Docs/Drive URL or the file ID.',
      );
    }
    const resolved = await resolveDriveItem(me.tenantId, type, externalId);
    const source = await projectsRepo.createSourceLinked(me.tenantId, {
      type,
      externalId: resolved.externalId,
      name: resolved.name,
      webLink: resolved.webLink,
    });
    logger.info({ type, externalId: resolved.externalId, name: resolved.name }, 'source linked by ref');
    return { data: source };
  });

  app.delete('/sources/:id', async (req) => {
    const me = currentUser(req);
    const { id } = idParams.parse(req.params);
    const ok = await projectsRepo.deleteSource(me.tenantId, id);
    if (!ok) throw Errors.notFound('Source not found.');
    return { data: { ok: true } };
  });

  // ── AI fetch: read each linked source, distill every clean project (noise-filtered) ──
  app.post('/fetch', async (req) => {
    const me = currentUser(req);
    if (!(await googleClient.isConnected(me.tenantId))) {
      throw Errors.upstream('Google is not connected.', 'Connect Google to scan your linked sources.');
    }
    const sources = (await projectsRepo.listSourceRows(me.tenantId)).filter((s) => s.external_id).slice(0, MAX_FETCH_SOURCES);
    for (const s of sources) {
      await projectsRepo.setSourceStatus(me.tenantId, s.id, 'scanning');
      try {
        const extracted =
          s.type === 'sheet'
            ? await extractProjectsFromSheet(s.name, await readSheetValues(me.tenantId, s.external_id!))
            : await extractProjects(s.type, s.name, await readSourceContent(me.tenantId, s.type, s.external_id!));
        await projectsRepo.createFromExtractions(
          me.tenantId,
          { type: s.type, name: s.name, externalId: s.external_id! },
          extracted,
        );
        logger.info({ source: s.name, projects: extracted.length }, 'source scanned into projects');
        await projectsRepo.setSourceStatus(me.tenantId, s.id, 'scanned');
      } catch (err) {
        logger.warn({ err, source: s.name }, 'project fetch failed for source');
        await projectsRepo.setSourceStatus(me.tenantId, s.id, 'linked');
      }
    }
    return { data: await projectsRepo.listByTenant(me.tenantId) };
  });

  // ── Projects ────────────────────────────────────────────────────────────
  app.get('/', async (req) => {
    const me = currentUser(req);
    return { data: await projectsRepo.listByTenant(me.tenantId) };
  });

  app.post('/', async (req) => {
    const me = currentUser(req);
    const body = createProjectSchema.parse(req.body);
    const summary = await summarizeManual(body.name, body.description ?? null);
    const project = await projectsRepo.createManual(me.tenantId, {
      name: body.name,
      priority: body.priority,
      deadline: body.deadline ?? null,
      owner: 'You',
      summary,
    });
    return { data: project };
  });

  app.get('/:id', async (req) => {
    const me = currentUser(req);
    const { id } = idParams.parse(req.params);
    const project = await projectsRepo.getById(me.tenantId, id);
    if (!project) throw Errors.notFound('Project not found.');
    return { data: project };
  });

  // Edit core fields ("edit everything").
  app.put('/:id', async (req) => {
    const me = currentUser(req);
    const { id } = idParams.parse(req.params);
    const patch = updateProjectSchema.parse(req.body);
    const ok = await projectsRepo.updateProject(me.tenantId, id, patch);
    if (!ok) throw Errors.notFound('Project not found.');
    return { data: await projectsRepo.getById(me.tenantId, id) };
  });

  app.delete('/:id', async (req) => {
    const me = currentUser(req);
    const { id } = idParams.parse(req.params);
    const ok = await projectsRepo.deleteProject(me.tenantId, id);
    if (!ok) throw Errors.notFound('Project not found.');
    return { data: { ok: true } };
  });

  // ── Tasks ─────────────────────────────────────────────────────────────────
  app.patch('/:id/tasks/:taskId', async (req) => {
    const me = currentUser(req);
    const { id, taskId } = taskParams.parse(req.params);
    const { done } = z.object({ done: z.boolean() }).parse(req.body);
    const owner = await projectsRepo.findTaskProjectId(me.tenantId, taskId);
    if (!owner || owner !== id) throw Errors.notFound('Task not found.');
    await projectsRepo.setTaskDone(me.tenantId, taskId, done);
    return { data: await projectsRepo.getById(me.tenantId, id) };
  });

  app.post('/:id/tasks', async (req) => {
    const me = currentUser(req);
    const { id } = idParams.parse(req.params);
    const { title } = addTaskSchema.parse(req.body);
    if (!(await projectsRepo.addTask(me.tenantId, id, title))) throw Errors.notFound('Project not found.');
    return { data: await projectsRepo.getById(me.tenantId, id) };
  });

  app.put('/:id/tasks/:taskId', async (req) => {
    const me = currentUser(req);
    const { id, taskId } = taskParams.parse(req.params);
    const patch = updateTaskSchema.parse(req.body);
    if (!(await projectsRepo.updateTask(me.tenantId, taskId, patch))) throw Errors.notFound('Task not found.');
    return { data: await projectsRepo.getById(me.tenantId, id) };
  });

  app.delete('/:id/tasks/:taskId', async (req) => {
    const me = currentUser(req);
    const { id, taskId } = taskParams.parse(req.params);
    if (!(await projectsRepo.deleteTask(me.tenantId, taskId))) throw Errors.notFound('Task not found.');
    return { data: await projectsRepo.getById(me.tenantId, id) };
  });

  // ── Fields ──────────────────────────────────────────────────────────────
  app.post('/:id/fields', async (req) => {
    const me = currentUser(req);
    const { id } = idParams.parse(req.params);
    const { label, value } = fieldSchema.parse(req.body);
    if (!(await projectsRepo.addField(me.tenantId, id, label, value))) throw Errors.notFound('Project not found.');
    return { data: await projectsRepo.getById(me.tenantId, id) };
  });

  app.put('/:id/fields/:fieldId', async (req) => {
    const me = currentUser(req);
    const { id, fieldId } = fieldParams.parse(req.params);
    const { label, value } = fieldSchema.parse(req.body);
    if (!(await projectsRepo.updateField(me.tenantId, fieldId, label, value))) throw Errors.notFound('Field not found.');
    return { data: await projectsRepo.getById(me.tenantId, id) };
  });

  app.delete('/:id/fields/:fieldId', async (req) => {
    const me = currentUser(req);
    const { id, fieldId } = fieldParams.parse(req.params);
    if (!(await projectsRepo.deleteField(me.tenantId, fieldId))) throw Errors.notFound('Field not found.');
    return { data: await projectsRepo.getById(me.tenantId, id) };
  });
}
