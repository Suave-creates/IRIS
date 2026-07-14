import type { RowDataPacket } from 'mysql2/promise';
import type {
  Priority,
  Project,
  ProjectActivity,
  ProjectField,
  ProjectFileRef,
  ProjectSource,
  ProjectSourceType,
  ProjectTask,
} from '@iris/shared';
import { execute, query, withTransaction } from '../../db/pool.js';
import { id } from '../../lib/ids.js';

// ── Row shapes (DB snake_case) ──────────────────────────────────────────────
interface ProjectRow extends RowDataPacket {
  id: string;
  tenant_id: string;
  name: string;
  source: ProjectSourceType;
  priority: Priority;
  status: string;
  deadline: string | null;
  progress: number;
  owner: string;
  auto: number;
  summary: string | null;
  source_detail: string | null;
  stages: string | string[] | null;
  current_stage: number;
  created_at: string;
  updated_at: string;
}

interface FieldRow extends RowDataPacket {
  id: string;
  project_id: string;
  label: string;
  value: string;
  position: number;
}

interface TaskRow extends RowDataPacket {
  id: string;
  project_id: string;
  title: string;
  done: number;
  position: number;
}

interface FileRow extends RowDataPacket {
  id: string;
  project_id: string;
  name: string;
  kind: string;
  position: number;
}

interface ActivityRow extends RowDataPacket {
  id: string;
  project_id: string;
  who: string;
  act: string;
  created_at: string;
}

interface SourceRow extends RowDataPacket {
  id: string;
  tenant_id: string;
  type: 'folder' | 'sheet' | 'doc';
  name: string;
  meta: string | null;
  external_id: string | null;
  web_link: string | null;
  status: 'linked' | 'scanning' | 'scanned';
  created_at: string;
}

// ── Mapping helpers ─────────────────────────────────────────────────────────

/** Default stages applied to manual/auto projects when none are stored. */
const DEFAULT_STAGES = ['Planning', 'In progress', 'Review', 'Done'];

/** Parse a JSON column that may arrive as a string (dateStrings/driver quirks) or already-parsed array. */
function parseStages(raw: string | string[] | null): string[] {
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string');
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Render a project_activity.created_at (a DATETIME string like "2026-06-23 14:05:00")
 * into a friendly relative-or-absolute label for the DTO's `time` field.
 */
function relativeTime(createdAt: string): string {
  const then = new Date(createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z');
  const ms = then.getTime();
  if (Number.isNaN(ms)) return createdAt;
  const diff = Date.now() - ms;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  // Older than a month → absolute date (YYYY-MM-DD).
  return then.toISOString().slice(0, 10);
}

function toField(r: FieldRow): ProjectField {
  return { id: r.id, label: r.label, value: r.value };
}
function toTask(r: TaskRow): ProjectTask {
  return { id: r.id, title: r.title, done: r.done === 1 };
}
function toFile(r: FileRow): ProjectFileRef {
  return { name: r.name, kind: r.kind };
}
function toActivity(r: ActivityRow): ProjectActivity {
  return { who: r.who, act: r.act, time: relativeTime(r.created_at) };
}
function toSource(r: SourceRow): ProjectSource {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    meta: r.meta ?? null,
    status: r.status,
    externalId: r.external_id ?? null,
    webLink: r.web_link ?? null,
  };
}

interface Children {
  fields: FieldRow[];
  tasks: TaskRow[];
  files: FileRow[];
  activity: ActivityRow[];
}

function toProject(p: ProjectRow, c: Children): Project {
  const stages = parseStages(p.stages);
  return {
    id: p.id,
    name: p.name,
    source: p.source,
    priority: p.priority,
    status: p.status,
    deadline: p.deadline ?? null,
    progress: p.progress,
    owner: p.owner,
    auto: p.auto === 1,
    summary: p.summary ?? '',
    sourceDetail: p.source_detail ?? null,
    stages: stages.length ? stages : DEFAULT_STAGES,
    currentStage: p.current_stage,
    fields: c.fields.map(toField),
    tasks: c.tasks.map(toTask),
    files: c.files.map(toFile),
    activity: c.activity.map(toActivity),
  };
}

// Priority ranking: critical < high < med < low (lower number sorts first).
const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, med: 2, low: 3 };

// ── Auto-scan template projects (stands in for real Drive scanning until M4) ──
interface AutoTemplate {
  name: string;
  source: ProjectSourceType;
  priority: Priority;
  status: string;
  progress: number;
  summary: string;
  sourceDetail: string;
  stages: string[];
  currentStage: number;
  fields: { label: string; value: string }[];
}

const AUTO_TEMPLATES: AutoTemplate[] = [
  {
    name: 'Q3 Board Deck',
    source: 'folder',
    priority: 'high',
    status: 'In progress',
    progress: 45,
    summary: 'Quarterly board presentation assembled from the shared Drive folder.',
    sourceDetail: 'Drive · /Board/Q3',
    stages: ['Outline', 'Draft', 'Review', 'Final'],
    currentStage: 1,
    fields: [
      { label: 'Owner', value: 'You' },
      { label: 'Reviewers', value: '3' },
    ],
  },
  {
    name: 'Hiring Plan FY26',
    source: 'doc',
    priority: 'med',
    status: 'Review',
    progress: 70,
    summary: 'Headcount and hiring roadmap detected in a linked Google Doc.',
    sourceDetail: 'Doc · Hiring Plan FY26',
    stages: ['Planning', 'In progress', 'Review', 'Done'],
    currentStage: 2,
    fields: [
      { label: 'Open roles', value: '12' },
      { label: 'Departments', value: '4' },
    ],
  },
  {
    name: 'Revenue Tracker',
    source: 'sheet',
    priority: 'critical',
    status: 'In progress',
    progress: 30,
    summary: 'Live revenue model surfaced from a linked spreadsheet.',
    sourceDetail: 'Sheet · Revenue Tracker',
    stages: ['Setup', 'Tracking', 'Reconcile', 'Closed'],
    currentStage: 1,
    fields: [
      { label: 'Period', value: 'Q3 FY26' },
      { label: 'Variance', value: '-4%' },
    ],
  },
];

// ── Repository ──────────────────────────────────────────────────────────────
export const projectsRepo = {
  /** Returns the raw project row IF it belongs to the tenant, else null. */
  async findRow(tenantId: string, projectId: string): Promise<ProjectRow | null> {
    const rows = await query<ProjectRow[]>(
      'SELECT * FROM projects WHERE id = :pid AND tenant_id = :tid',
      { pid: projectId, tid: tenantId },
    );
    return rows[0] ?? null;
  },

  /** Hydrates a single project (children fetched per-project). Returns null if not in tenant. */
  async getById(tenantId: string, projectId: string): Promise<Project | null> {
    const row = await this.findRow(tenantId, projectId);
    if (!row) return null;
    const [fields, tasks, files, activity] = await Promise.all([
      query<FieldRow[]>('SELECT * FROM project_fields WHERE project_id = :pid ORDER BY position, id', { pid: projectId }),
      query<TaskRow[]>('SELECT * FROM project_tasks WHERE project_id = :pid ORDER BY position, id', { pid: projectId }),
      query<FileRow[]>('SELECT * FROM project_files WHERE project_id = :pid ORDER BY position, id', { pid: projectId }),
      query<ActivityRow[]>('SELECT * FROM project_activity WHERE project_id = :pid ORDER BY created_at DESC, id', { pid: projectId }),
    ]);
    return toProject(row, { fields, tasks, files, activity });
  },

  /**
   * Lists every project for the tenant, fully hydrated, sorted by priority rank
   * (critical < high < med < low) then deadline (nulls last).
   */
  async listByTenant(tenantId: string): Promise<Project[]> {
    const projects = await query<ProjectRow[]>('SELECT * FROM projects WHERE tenant_id = :tid', { tid: tenantId });
    if (projects.length === 0) return [];
    const ids = projects.map((p) => p.id);
    const placeholders = ids.map((_, i) => `:p${i}`).join(', ');
    const params: Record<string, unknown> = {};
    ids.forEach((pid, i) => {
      params[`p${i}`] = pid;
    });

    // Batch-load all children for this tenant's projects in one round-trip each.
    const [fields, tasks, files, activity] = await Promise.all([
      query<FieldRow[]>(`SELECT * FROM project_fields WHERE project_id IN (${placeholders}) ORDER BY position, id`, params),
      query<TaskRow[]>(`SELECT * FROM project_tasks WHERE project_id IN (${placeholders}) ORDER BY position, id`, params),
      query<FileRow[]>(`SELECT * FROM project_files WHERE project_id IN (${placeholders}) ORDER BY position, id`, params),
      query<ActivityRow[]>(`SELECT * FROM project_activity WHERE project_id IN (${placeholders}) ORDER BY created_at DESC, id`, params),
    ]);

    const byProject = <R extends { project_id: string }>(rows: R[]): Map<string, R[]> => {
      const m = new Map<string, R[]>();
      for (const r of rows) {
        const list = m.get(r.project_id);
        if (list) list.push(r);
        else m.set(r.project_id, [r]);
      }
      return m;
    };
    const fieldsMap = byProject(fields);
    const tasksMap = byProject(tasks);
    const filesMap = byProject(files);
    const activityMap = byProject(activity);

    const hydrated = projects.map((p) =>
      toProject(p, {
        fields: fieldsMap.get(p.id) ?? [],
        tasks: tasksMap.get(p.id) ?? [],
        files: filesMap.get(p.id) ?? [],
        activity: activityMap.get(p.id) ?? [],
      }),
    );

    hydrated.sort((a, b) => {
      const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (pr !== 0) return pr;
      // Deadline ascending, nulls last.
      if (a.deadline === b.deadline) return 0;
      if (a.deadline === null) return 1;
      if (b.deadline === null) return -1;
      return a.deadline < b.deadline ? -1 : 1;
    });
    return hydrated;
  },

  /** Creates a manual project + an initial "created this project" activity row. Returns the hydrated project. */
  async createManual(
    tenantId: string,
    input: { name: string; priority: Priority; deadline?: string | null; owner: string; summary?: string | null },
  ): Promise<Project> {
    const projectId = id('proj');
    await withTransaction(async (conn) => {
      await conn.execute(
        `INSERT INTO projects
           (id, tenant_id, name, source, priority, status, deadline, progress, owner, auto, summary, source_detail, stages, current_stage)
         VALUES
           (:id, :tid, :name, :source, :priority, :status, :deadline, :progress, :owner, :auto, :summary, :detail, :stages, :stage)`,
        {
          id: projectId,
          tid: tenantId,
          name: input.name,
          source: 'manual',
          priority: input.priority,
          status: 'New',
          deadline: input.deadline ?? null,
          progress: 0,
          owner: input.owner,
          auto: 0,
          summary: input.summary ?? null,
          detail: null,
          stages: JSON.stringify(DEFAULT_STAGES),
          stage: 0,
        } as never,
      );
      await conn.execute(
        `INSERT INTO project_activity (id, project_id, who, act) VALUES (:id, :pid, :who, :act)`,
        { id: id('pact'), pid: projectId, who: input.owner, act: 'created this project' } as never,
      );
    });
    const created = await this.getById(tenantId, projectId);
    if (!created) throw new Error('Failed to create project');
    return created;
  },

  /**
   * Toggles a task's `done` flag, but only if the task's parent project belongs to
   * the tenant (prevents cross-tenant tampering via guessed task ids).
   * Returns true if a row was updated.
   */
  async setTaskDone(tenantId: string, taskId: string, done: boolean): Promise<boolean> {
    const result = await execute(
      `UPDATE project_tasks pt
         JOIN projects p ON p.id = pt.project_id
          SET pt.done = :done
        WHERE pt.id = :tid AND p.tenant_id = :ten`,
      { done: done ? 1 : 0, tid: taskId, ten: tenantId },
    );
    return result.affectedRows > 0;
  },

  /** Resolves the parent project id for a task, scoped to the tenant (null if not owned). */
  async findTaskProjectId(tenantId: string, taskId: string): Promise<string | null> {
    const rows = await query<({ project_id: string } & RowDataPacket)[]>(
      `SELECT pt.project_id
         FROM project_tasks pt
         JOIN projects p ON p.id = pt.project_id
        WHERE pt.id = :tid AND p.tenant_id = :ten`,
      { tid: taskId, ten: tenantId },
    );
    return rows[0]?.project_id ?? null;
  },

  // ── Sources ──────────────────────────────────────────────────────────────
  async listSources(tenantId: string): Promise<ProjectSource[]> {
    const rows = await query<SourceRow[]>(
      'SELECT * FROM project_sources WHERE tenant_id = :tid ORDER BY created_at, id',
      { tid: tenantId },
    );
    return rows.map(toSource);
  },

  async findSourceRow(tenantId: string, sourceId: string): Promise<SourceRow | null> {
    const rows = await query<SourceRow[]>(
      'SELECT * FROM project_sources WHERE id = :sid AND tenant_id = :tid',
      { sid: sourceId, tid: tenantId },
    );
    return rows[0] ?? null;
  },

  async createSource(tenantId: string, type: 'folder' | 'sheet' | 'doc'): Promise<ProjectSource> {
    const sourceId = id('psrc');
    const defaults: Record<typeof type, { name: string; meta: string }> = {
      folder: { name: 'Drive folder', meta: 'Google Drive' },
      sheet: { name: 'Linked sheet', meta: 'Google Sheets' },
      doc: { name: 'Linked doc', meta: 'Google Docs' },
    };
    const { name, meta } = defaults[type];
    await execute(
      `INSERT INTO project_sources (id, tenant_id, type, name, meta, status)
       VALUES (:id, :tid, :type, :name, :meta, :status)`,
      { id: sourceId, tid: tenantId, type, name, meta, status: 'linked' },
    );
    const created = await this.findSourceRow(tenantId, sourceId);
    if (!created) throw new Error('Failed to create project source');
    return toSource(created);
  },

  /** Marks every tenant source as scanned. */
  async markSourcesScanned(tenantId: string): Promise<void> {
    await execute('UPDATE project_sources SET status = :scanned WHERE tenant_id = :tid', {
      scanned: 'scanned',
      tid: tenantId,
    });
  },

  /** Links a real connector item (e.g. a Drive file) as a project source. */
  async createSourceLinked(
    tenantId: string,
    input: { type: 'folder' | 'sheet' | 'doc'; name: string; externalId: string; webLink?: string | null; meta?: string | null },
  ): Promise<ProjectSource> {
    const sourceId = id('psrc');
    const metaByType = { folder: 'Google Drive folder', sheet: 'Google Sheets', doc: 'Google Docs' };
    await execute(
      `INSERT INTO project_sources (id, tenant_id, type, name, meta, external_id, web_link, status)
       VALUES (:id, :tid, :type, :name, :meta, :ext, :link, 'linked')`,
      {
        id: sourceId, tid: tenantId, type: input.type, name: input.name.slice(0, 200),
        meta: input.meta ?? metaByType[input.type], ext: input.externalId, link: input.webLink ?? null,
      },
    );
    const created = await this.findSourceRow(tenantId, sourceId);
    if (!created) throw new Error('Failed to link source');
    return toSource(created);
  },

  async deleteSource(tenantId: string, sourceId: string): Promise<boolean> {
    const r = await execute('DELETE FROM project_sources WHERE id = :sid AND tenant_id = :tid', {
      sid: sourceId, tid: tenantId,
    });
    return r.affectedRows > 0;
  },

  /** Raw source rows for the tenant (used by the AI fetch). */
  async listSourceRows(tenantId: string): Promise<SourceRow[]> {
    return query<SourceRow[]>('SELECT * FROM project_sources WHERE tenant_id = :tid ORDER BY created_at, id', {
      tid: tenantId,
    });
  },

  async deleteProject(tenantId: string, projectId: string): Promise<boolean> {
    const r = await execute('DELETE FROM projects WHERE id = :pid AND tenant_id = :tid', {
      pid: projectId, tid: tenantId,
    });
    return r.affectedRows > 0;
  },

  /** Updates core project fields; only the keys present in `patch` change. */
  async updateProject(
    tenantId: string,
    projectId: string,
    patch: { name?: string; priority?: Priority; deadline?: string | null; status?: string; owner?: string; summary?: string; progress?: number; currentStage?: number },
  ): Promise<boolean> {
    const r = await execute(
      `UPDATE projects SET
         name = COALESCE(:name, name),
         priority = COALESCE(:priority, priority),
         deadline = IF(:deadlineSet, :deadline, deadline),
         status = COALESCE(:status, status),
         owner = COALESCE(:owner, owner),
         summary = COALESCE(:summary, summary),
         progress = COALESCE(:progress, progress),
         current_stage = COALESCE(:currentStage, current_stage)
       WHERE id = :pid AND tenant_id = :tid`,
      {
        pid: projectId, tid: tenantId,
        name: patch.name ?? null,
        priority: patch.priority ?? null,
        deadlineSet: patch.deadline !== undefined ? 1 : 0,
        deadline: patch.deadline ?? null,
        status: patch.status ?? null,
        owner: patch.owner ?? null,
        summary: patch.summary ?? null,
        progress: patch.progress ?? null,
        currentStage: patch.currentStage ?? null,
      },
    );
    return r.affectedRows > 0;
  },

  // ── Field CRUD (tenant verified via join to projects) ─────────────────────
  async addField(tenantId: string, projectId: string, label: string, value: string): Promise<boolean> {
    const owner = await this.findRow(tenantId, projectId);
    if (!owner) return false;
    await execute(
      `INSERT INTO project_fields (id, project_id, label, value, position)
       VALUES (:id, :pid, :label, :value, (SELECT COALESCE(MAX(position)+1,0) FROM project_fields pf WHERE pf.project_id = :pid))`,
      { id: id('pfld'), pid: projectId, label: label.slice(0, 80), value: value.slice(0, 200) },
    );
    return true;
  },
  async updateField(tenantId: string, fieldId: string, label: string, value: string): Promise<boolean> {
    const r = await execute(
      `UPDATE project_fields pf JOIN projects p ON p.id = pf.project_id
         SET pf.label = :label, pf.value = :value
       WHERE pf.id = :fid AND p.tenant_id = :tid`,
      { fid: fieldId, tid: tenantId, label: label.slice(0, 80), value: value.slice(0, 200) },
    );
    return r.affectedRows > 0;
  },
  async deleteField(tenantId: string, fieldId: string): Promise<boolean> {
    const r = await execute(
      `DELETE pf FROM project_fields pf JOIN projects p ON p.id = pf.project_id WHERE pf.id = :fid AND p.tenant_id = :tid`,
      { fid: fieldId, tid: tenantId },
    );
    return r.affectedRows > 0;
  },

  // ── Task add/edit/delete (toggle lives in setTaskDone) ────────────────────
  async addTask(tenantId: string, projectId: string, title: string): Promise<boolean> {
    const owner = await this.findRow(tenantId, projectId);
    if (!owner) return false;
    await execute(
      `INSERT INTO project_tasks (id, project_id, title, done, position)
       VALUES (:id, :pid, :title, 0, (SELECT COALESCE(MAX(position)+1,0) FROM project_tasks pt WHERE pt.project_id = :pid))`,
      { id: id('ptsk'), pid: projectId, title: title.slice(0, 255) },
    );
    return true;
  },
  async updateTask(tenantId: string, taskId: string, patch: { title?: string; done?: boolean }): Promise<boolean> {
    const r = await execute(
      `UPDATE project_tasks pt JOIN projects p ON p.id = pt.project_id
         SET pt.title = COALESCE(:title, pt.title), pt.done = COALESCE(:done, pt.done)
       WHERE pt.id = :tid AND p.tenant_id = :ten`,
      { tid: taskId, ten: tenantId, title: patch.title ?? null, done: patch.done === undefined ? null : patch.done ? 1 : 0 },
    );
    return r.affectedRows > 0;
  },
  async deleteTask(tenantId: string, taskId: string): Promise<boolean> {
    const r = await execute(
      `DELETE pt FROM project_tasks pt JOIN projects p ON p.id = pt.project_id WHERE pt.id = :tid AND p.tenant_id = :ten`,
      { tid: taskId, ten: tenantId },
    );
    return r.affectedRows > 0;
  },

  /** Creates (or refreshes) all projects distilled by AI from a single linked source. */
  async createFromExtractions(
    tenantId: string,
    source: { type: ProjectSourceType; name: string; externalId: string },
    list: {
      name: string; summary: string; priority: Priority; deadline: string | null; status: string;
      /** Stakeholder email, captured silently for People-linking — never shown/edited in the Projects UI. */
      ownerEmail?: string | null;
      fields: { label: string; value: string }[]; tasks: { title: string }[]; stages: string[]; currentStage: number;
    }[],
  ): Promise<void> {
    await withTransaction(async (conn) => {
      // Refresh: drop every prior project from this source (children cascade), then re-insert the full set.
      await conn.execute('DELETE FROM projects WHERE tenant_id = :tid AND source_ref = :ref', {
        tid: tenantId, ref: source.externalId,
      } as never);

      for (const ex of list) {
        const stages = ex.stages.length ? ex.stages : DEFAULT_STAGES;
        const currentStage = Math.max(0, Math.min(ex.currentStage, stages.length - 1));
        const progress = Math.round(((currentStage + 1) / stages.length) * 100);
        const projectId = id('proj');
        await conn.execute(
          `INSERT INTO projects
             (id, tenant_id, name, source, priority, status, deadline, progress, owner, owner_email, auto, summary, source_detail, source_ref, stages, current_stage)
           VALUES
             (:id, :tid, :name, :source, :priority, :status, :deadline, :progress, 'IRIS', :ownerEmail, 1, :summary, :detail, :ref, :stages, :stage)`,
          {
            id: projectId, tid: tenantId, name: ex.name.slice(0, 200), source: source.type, priority: ex.priority,
            status: ex.status.slice(0, 40), deadline: ex.deadline, progress, ownerEmail: ex.ownerEmail ?? null,
            summary: ex.summary, detail: `${source.type} · ${source.name}`, ref: source.externalId,
            stages: JSON.stringify(stages), stage: currentStage,
          } as never,
        );
        for (let i = 0; i < ex.fields.length; i++) {
          const f = ex.fields[i]!;
          await conn.execute(
            `INSERT INTO project_fields (id, project_id, label, value, position) VALUES (:id, :pid, :label, :value, :pos)`,
            { id: id('pfld'), pid: projectId, label: f.label, value: f.value, pos: i } as never,
          );
        }
        for (let i = 0; i < ex.tasks.length; i++) {
          await conn.execute(
            `INSERT INTO project_tasks (id, project_id, title, done, position) VALUES (:id, :pid, :title, 0, :pos)`,
            { id: id('ptsk'), pid: projectId, title: ex.tasks[i]!.title, pos: i } as never,
          );
        }
        await conn.execute(
          `INSERT INTO project_activity (id, project_id, who, act) VALUES (:id, :pid, 'IRIS', :act)`,
          { id: id('pact'), pid: projectId, act: `extracted this project from ${source.name}` } as never,
        );
      }
    });
  },

  /** Marks a single source's scan status. */
  async setSourceStatus(tenantId: string, sourceId: string, status: 'linked' | 'scanning' | 'scanned'): Promise<void> {
    await execute('UPDATE project_sources SET status = :s WHERE id = :sid AND tenant_id = :tid', {
      s: status, sid: sourceId, tid: tenantId,
    });
  },

  /** Returns the set of project names already present for the tenant (for idempotent seeding). */
  async existingNames(tenantId: string): Promise<Set<string>> {
    const rows = await query<({ name: string } & RowDataPacket)[]>(
      'SELECT name FROM projects WHERE tenant_id = :tid',
      { tid: tenantId },
    );
    return new Set(rows.map((r) => r.name));
  },

  /**
   * Idempotently seeds up to 3 'auto' template projects (skipping any whose name
   * already exists for the tenant), each with summary/fields/stages and a
   * "discovered this project" activity row.
   */
  async seedAutoProjects(tenantId: string): Promise<void> {
    const existing = await this.existingNames(tenantId);
    const toCreate = AUTO_TEMPLATES.filter((t) => !existing.has(t.name));
    if (toCreate.length === 0) return;

    await withTransaction(async (conn) => {
      for (const t of toCreate) {
        const projectId = id('proj');
        await conn.execute(
          `INSERT INTO projects
             (id, tenant_id, name, source, priority, status, deadline, progress, owner, auto, summary, source_detail, stages, current_stage)
           VALUES
             (:id, :tid, :name, :source, :priority, :status, :deadline, :progress, :owner, :auto, :summary, :detail, :stages, :stage)`,
          {
            id: projectId,
            tid: tenantId,
            name: t.name,
            source: t.source,
            priority: t.priority,
            status: t.status,
            deadline: null,
            progress: t.progress,
            owner: 'IRIS',
            auto: 1,
            summary: t.summary,
            detail: t.sourceDetail,
            stages: JSON.stringify(t.stages),
            stage: t.currentStage,
          } as never,
        );
        for (let i = 0; i < t.fields.length; i++) {
          const f = t.fields[i]!;
          await conn.execute(
            `INSERT INTO project_fields (id, project_id, label, value, position) VALUES (:id, :pid, :label, :value, :pos)`,
            { id: id('pfld'), pid: projectId, label: f.label, value: f.value, pos: i } as never,
          );
        }
        await conn.execute(
          `INSERT INTO project_activity (id, project_id, who, act) VALUES (:id, :pid, :who, :act)`,
          { id: id('pact'), pid: projectId, who: 'IRIS', act: 'discovered this project' } as never,
        );
      }
    });
  },
};
