import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PERSON_CATEGORIES, PERSON_FUNCTIONS, normalizeLocation } from '@iris/shared';
import type { PersonFileRow } from '@iris/shared';
import { Errors } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { currentUser, requireAuth } from '../auth/guards.js';
import { googleClient } from '../../connectors/google/client.js';
import { searchPeople } from '../../connectors/google/calendar.js';
import { listFilesSharedBy } from '../../connectors/google/drive.js';
import { dateLabel } from '../../lib/design-frame.js';
import { buildPersonContext, driveKindChip } from './people.derive.js';
import { peopleRepo } from './people.repo.js';

/**
 * Files this person has shared with the signed-in user, pulled live from
 * Google Drive. Best-effort: no email / Google not connected / API failure
 * all degrade to an empty list.
 */
async function sharedDriveFiles(tenantId: string, email: string | null): Promise<PersonFileRow[]> {
  if (!email) return [];
  try {
    if (!(await googleClient.isConnected(tenantId))) return [];
    const files = await listFilesSharedBy(tenantId, email);
    return files.map((f) => ({
      name: f.name,
      kind: driveKindChip(f.mimeType),
      meta: f.sharedAt ? `Shared ${dateLabel(f.sharedAt)} · Google Drive` : 'Shared with you · Google Drive',
      ref: f.webViewLink,
    }));
  } catch (err) {
    logger.warn({ err, tenantId }, 'shared-drive lookup failed for person context');
    return [];
  }
}

// An empty array is valid: the grid can toggle off a person's last day
// ("No days set" / Dormant is a modeled state). The add/edit form enforces
// its own ≥1-day rule client-side before saving.
const daysSchema = z.array(z.number().int().min(1).max(6)).max(6);

// Locations are user-extensible site codes: 2–12 letters/digits, stored uppercase.
const locationSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{2,12}$/, 'Location must be 2–12 letters or digits.')
  .transform((code) => normalizeLocation(code));

const createPersonSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.enum(PERSON_CATEGORIES),
  func: z.enum(PERSON_FUNCTIONS),
  location: locationSchema,
  days: daysSchema,
  email: z.string().trim().email().max(255).nullish(),
  company: z.string().trim().max(160).nullish(),
  role: z.string().trim().max(160).nullish(),
});

const updatePersonSchema = createPersonSchema.partial();

const bulkPeopleSchema = z.object({
  people: z.array(createPersonSchema).min(1).max(200),
});

const bulkRemoveSchema = z.object({
  ids: z.array(z.string().min(1).max(40)).min(1).max(500),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

/** Dedupe + ascending sort — day cells can arrive unordered from the grid toggles. */
function normalizeDays(days: number[]): number[] {
  return [...new Set(days)].sort((a, b) => a - b);
}

export async function peopleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // List the roster with server-computed engagement per person.
  app.get('/', async (req) => {
    const me = currentUser(req);
    return { data: await peopleRepo.listByTenant(me.tenantId) };
  });

  // Add a person to the roster.
  app.post('/', async (req) => {
    const me = currentUser(req);
    const body = createPersonSchema.parse(req.body);
    return { data: await peopleRepo.create(me.tenantId, { ...body, days: normalizeDays(body.days) }) };
  });

  // Contact autocomplete: searches the user's Google Contacts + Workspace
  // directory (like Gmail's To-field). Best-effort — [] when not connected.
  app.get('/contact-suggest', async (req) => {
    const me = currentUser(req);
    const { q } = z.object({ q: z.string().trim().max(120) }).parse(req.query);
    if (q.length < 2 || !(await googleClient.isConnected(me.tenantId))) return { data: [] };
    return { data: await searchPeople(me.tenantId, q) };
  });

  // Bulk roster import: skips names that already exist (case-insensitive),
  // inserts the rest in one transaction, and reports both buckets.
  app.post('/bulk', async (req) => {
    const me = currentUser(req);
    const { people } = bulkPeopleSchema.parse(req.body);

    const existing = await peopleRepo.listByTenant(me.tenantId);
    const taken = new Set(existing.map((p) => p.name.trim().toLowerCase()));

    const toCreate: typeof people = [];
    const skipped: string[] = [];
    for (const person of people) {
      const key = person.name.trim().toLowerCase();
      if (taken.has(key)) {
        skipped.push(person.name.trim());
        continue;
      }
      taken.add(key); // also dedupes within the payload
      toCreate.push({ ...person, days: normalizeDays(person.days) });
    }

    const created = await peopleRepo.createMany(me.tenantId, toCreate);
    logger.info({ tenantId: me.tenantId, created: created.length, skipped: skipped.length }, 'bulk people import');
    return { data: { created, skipped } };
  });

  // Edit a person (partial — the grid's day toggles PATCH just `days`).
  app.patch('/:id', async (req) => {
    const me = currentUser(req);
    const { id } = idParamsSchema.parse(req.params);
    const patch = updatePersonSchema.parse(req.body);
    const ok = await peopleRepo.update(me.tenantId, id, {
      ...patch,
      ...(patch.days ? { days: normalizeDays(patch.days) } : {}),
    });
    if (!ok) throw Errors.notFound('Person not found.');
    const updated = await peopleRepo.getById(me.tenantId, id);
    if (!updated) throw Errors.notFound('Person not found.');
    return { data: updated };
  });

  // Remove a person (engagement events cascade in the schema).
  app.delete('/:id', async (req) => {
    const me = currentUser(req);
    const { id } = idParamsSchema.parse(req.params);
    const ok = await peopleRepo.remove(me.tenantId, id);
    if (!ok) throw Errors.notFound('Person not found.');
    return { data: { ok: true } };
  });

  // Bulk remove: deletes the given people (engagement events cascade).
  app.post('/bulk-remove', async (req) => {
    const me = currentUser(req);
    const { ids } = bulkRemoveSchema.parse(req.body);
    const removed = await peopleRepo.removeMany(me.tenantId, [...new Set(ids)]);
    logger.info({ tenantId: me.tenantId, removed }, 'bulk people remove');
    return { data: { removed } };
  });

  // The full drawer payload (summary, calendar, timeline, topics, actions,
  // files, insights) — aggregated from real meetings and engagement events.
  app.get('/:id/context', async (req) => {
    const me = currentUser(req);
    const { id } = idParamsSchema.parse(req.params);
    const found = await peopleRepo.getWithEvents(me.tenantId, id);
    if (!found) throw Errors.notFound('Person not found.');
    const [meetings, actions, artifacts, driveFiles] = await Promise.all([
      peopleRepo.meetingsForPerson(me.tenantId, found.person.name),
      peopleRepo.actionsForPerson(me.tenantId, found.person.name),
      peopleRepo.artifactsForPerson(me.tenantId, found.person.name),
      sharedDriveFiles(me.tenantId, found.person.email),
    ]);
    const context = buildPersonContext(found.person, found.events, meetings, actions, artifacts);
    // Real Drive files this person shared lead the Files tab; meeting artifacts follow.
    context.files = [...driveFiles, ...context.files];
    return { data: context };
  });
}
