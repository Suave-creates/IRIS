import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser, requireAuth } from '../auth/guards.js';
import { Errors } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { googleClient } from '../../connectors/google/client.js';
import { listDriveSources, parseDriveRef, readSourceContent, readSpreadsheetTabs, resolveDriveItem } from '../../connectors/google/drive.js';
import { kpiRepo } from './kpi.repo.js';
import { extractKpis, extractKpisFromSheet, summarizeManualKpi } from './kpi.ai.js';

const createKpiSchema = z.object({
  name: z.string().trim().min(1).max(200),
  priority: z.enum(['critical', 'high', 'med', 'low']),
  unit: z.string().trim().max(40).nullish(),
  target: z.string().trim().max(80).nullish(),
  period: z.string().trim().max(60).nullish(),
  description: z.string().trim().max(2000).nullish(),
});

const updateKpiSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  priority: z.enum(['critical', 'high', 'med', 'low']).optional(),
  status: z.string().trim().min(1).max(40).optional(),
  owner: z.string().trim().min(1).max(160).optional(),
  summary: z.string().trim().max(2000).optional(),
  unit: z.string().trim().max(40).nullable().optional(),
  target: z.string().trim().max(80).nullable().optional(),
  actual: z.string().trim().max(80).nullable().optional(),
  trend: z.enum(['up', 'down', 'flat']).optional(),
  period: z.string().trim().max(60).nullable().optional(),
  attainment: z.number().int().min(0).max(100).optional(),
});

const linkSourceSchema = z.object({
  type: z.enum(['folder', 'sheet', 'doc']),
  externalId: z.string().trim().regex(/^[A-Za-z0-9_-]+$/, 'Invalid Drive ID.').min(1).max(255),
  name: z.string().trim().min(1).max(200),
  webLink: z.string().trim().max(512).nullish(),
});
const linkByRefSchema = z.object({ type: z.enum(['folder', 'sheet', 'doc']), ref: z.string().trim().min(1).max(1024) });
const fieldSchema = z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().max(200) });
const addInitiativeSchema = z.object({ title: z.string().trim().min(1).max(255) });
const idParams = z.object({ id: z.string().min(1) });
const initiativeParams = z.object({ id: z.string().min(1), initiativeId: z.string().min(1) });
const fieldParams = z.object({ id: z.string().min(1), fieldId: z.string().min(1) });

const MAX_FETCH_SOURCES = 6;

export async function kpiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // ── Sources ─────────────────────────────────────────────────────────────
  app.get('/sources', async (req) => {
    const me = currentUser(req);
    return { data: await kpiRepo.listSources(me.tenantId) };
  });

  app.get('/sources/available', async (req) => {
    const me = currentUser(req);
    const { type } = z.object({ type: z.enum(['folder', 'sheet', 'doc']) }).parse(req.query);
    if (!(await googleClient.isConnected(me.tenantId))) {
      throw Errors.upstream('Google is not connected.', 'Connect Google on the Connectors page to link real sources.');
    }
    return { data: await listDriveSources(me.tenantId, type) };
  });

  app.post('/sources', async (req) => {
    const me = currentUser(req);
    const body = linkSourceSchema.parse(req.body);
    return { data: await kpiRepo.createSourceLinked(me.tenantId, body) };
  });

  app.post('/sources/by-ref', async (req) => {
    const me = currentUser(req);
    const { type, ref } = linkByRefSchema.parse(req.body);
    if (!(await googleClient.isConnected(me.tenantId))) {
      throw Errors.upstream('Google is not connected.', 'Connect Google on the Connectors page to link real sources.');
    }
    const externalId = parseDriveRef(ref);
    if (!externalId) {
      throw Errors.validation('Could not find a Google Drive ID in that link. Paste a full Google Sheets/Docs/Drive URL or the file ID.');
    }
    const resolved = await resolveDriveItem(me.tenantId, type, externalId);
    const source = await kpiRepo.createSourceLinked(me.tenantId, {
      type, externalId: resolved.externalId, name: resolved.name, webLink: resolved.webLink,
    });
    logger.info({ type, externalId: resolved.externalId, name: resolved.name }, 'kpi source linked by ref');
    return { data: source };
  });

  app.delete('/sources/:id', async (req) => {
    const me = currentUser(req);
    const { id } = idParams.parse(req.params);
    if (!(await kpiRepo.deleteSource(me.tenantId, id))) throw Errors.notFound('Source not found.');
    return { data: { ok: true } };
  });

  // ── AI fetch: read each linked source, distill every clean KPI ──
  app.post('/fetch', async (req) => {
    const me = currentUser(req);
    if (!(await googleClient.isConnected(me.tenantId))) {
      throw Errors.upstream('Google is not connected.', 'Connect Google to scan your linked sources.');
    }
    const sources = (await kpiRepo.listSourceRows(me.tenantId)).filter((s) => s.external_id).slice(0, MAX_FETCH_SOURCES);
    for (const s of sources) {
      await kpiRepo.setSourceStatus(me.tenantId, s.id, 'scanning');
      try {
        const extracted =
          s.type === 'sheet'
            ? await extractKpisFromSheet(s.name, await readSpreadsheetTabs(me.tenantId, s.external_id!))
            : await extractKpis(s.type, s.name, await readSourceContent(me.tenantId, s.type, s.external_id!));
        await kpiRepo.createFromExtractions(me.tenantId, { type: s.type, name: s.name, externalId: s.external_id! }, extracted);
        logger.info({ source: s.name, kpis: extracted.length }, 'source scanned into KPIs');
        await kpiRepo.setSourceStatus(me.tenantId, s.id, 'scanned');
      } catch (err) {
        logger.warn({ err, source: s.name }, 'kpi fetch failed for source');
        await kpiRepo.setSourceStatus(me.tenantId, s.id, 'linked');
      }
    }
    return { data: await kpiRepo.listByTenant(me.tenantId) };
  });

  // ── KPIs ────────────────────────────────────────────────────────────────
  app.get('/', async (req) => {
    const me = currentUser(req);
    return { data: await kpiRepo.listByTenant(me.tenantId) };
  });

  app.post('/', async (req) => {
    const me = currentUser(req);
    const body = createKpiSchema.parse(req.body);
    const summary = await summarizeManualKpi(body.name, body.description ?? null);
    const kpi = await kpiRepo.createManual(me.tenantId, {
      name: body.name, priority: body.priority, unit: body.unit ?? null, target: body.target ?? null,
      period: body.period ?? null, owner: 'You', summary,
    });
    return { data: kpi };
  });

  app.get('/:id', async (req) => {
    const me = currentUser(req);
    const { id } = idParams.parse(req.params);
    const kpi = await kpiRepo.getById(me.tenantId, id);
    if (!kpi) throw Errors.notFound('KPI not found.');
    return { data: kpi };
  });

  app.put('/:id', async (req) => {
    const me = currentUser(req);
    const { id } = idParams.parse(req.params);
    const patch = updateKpiSchema.parse(req.body);
    if (!(await kpiRepo.updateKpi(me.tenantId, id, patch))) throw Errors.notFound('KPI not found.');
    return { data: await kpiRepo.getById(me.tenantId, id) };
  });

  app.delete('/:id', async (req) => {
    const me = currentUser(req);
    const { id } = idParams.parse(req.params);
    if (!(await kpiRepo.deleteKpi(me.tenantId, id))) throw Errors.notFound('KPI not found.');
    return { data: { ok: true } };
  });

  // ── Initiatives ─────────────────────────────────────────────────────────
  app.patch('/:id/initiatives/:initiativeId', async (req) => {
    const me = currentUser(req);
    const { id, initiativeId } = initiativeParams.parse(req.params);
    const { done } = z.object({ done: z.boolean() }).parse(req.body);
    const owner = await kpiRepo.findInitiativeKpiId(me.tenantId, initiativeId);
    if (!owner || owner !== id) throw Errors.notFound('Initiative not found.');
    await kpiRepo.setInitiativeDone(me.tenantId, initiativeId, done);
    return { data: await kpiRepo.getById(me.tenantId, id) };
  });

  app.post('/:id/initiatives', async (req) => {
    const me = currentUser(req);
    const { id } = idParams.parse(req.params);
    const { title } = addInitiativeSchema.parse(req.body);
    if (!(await kpiRepo.addInitiative(me.tenantId, id, title))) throw Errors.notFound('KPI not found.');
    return { data: await kpiRepo.getById(me.tenantId, id) };
  });

  app.delete('/:id/initiatives/:initiativeId', async (req) => {
    const me = currentUser(req);
    const { id, initiativeId } = initiativeParams.parse(req.params);
    if (!(await kpiRepo.deleteInitiative(me.tenantId, initiativeId))) throw Errors.notFound('Initiative not found.');
    return { data: await kpiRepo.getById(me.tenantId, id) };
  });

  // ── Fields ──────────────────────────────────────────────────────────────
  app.post('/:id/fields', async (req) => {
    const me = currentUser(req);
    const { id } = idParams.parse(req.params);
    const { label, value } = fieldSchema.parse(req.body);
    if (!(await kpiRepo.addField(me.tenantId, id, label, value))) throw Errors.notFound('KPI not found.');
    return { data: await kpiRepo.getById(me.tenantId, id) };
  });

  app.put('/:id/fields/:fieldId', async (req) => {
    const me = currentUser(req);
    const { id, fieldId } = fieldParams.parse(req.params);
    const { label, value } = fieldSchema.parse(req.body);
    if (!(await kpiRepo.updateField(me.tenantId, fieldId, label, value))) throw Errors.notFound('Field not found.');
    return { data: await kpiRepo.getById(me.tenantId, id) };
  });

  app.delete('/:id/fields/:fieldId', async (req) => {
    const me = currentUser(req);
    const { id, fieldId } = fieldParams.parse(req.params);
    if (!(await kpiRepo.deleteField(me.tenantId, fieldId))) throw Errors.notFound('Field not found.');
    return { data: await kpiRepo.getById(me.tenantId, id) };
  });
}
