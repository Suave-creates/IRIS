import type { RowDataPacket } from 'mysql2/promise';
import type {
  Kpi,
  KpiActivity,
  KpiField,
  KpiInitiative,
  KpiTrend,
  Priority,
  ProjectSource,
  ProjectSourceType,
} from '@iris/shared';
import { execute, query, withTransaction } from '../../db/pool.js';
import { id } from '../../lib/ids.js';

// ── Row shapes (DB snake_case) ──────────────────────────────────────────────
interface KpiRow extends RowDataPacket {
  id: string;
  tenant_id: string;
  name: string;
  source: ProjectSourceType;
  priority: Priority;
  status: string;
  owner: string;
  auto: number;
  summary: string | null;
  source_detail: string | null;
  unit: string | null;
  target: string | null;
  actual: string | null;
  trend: KpiTrend;
  period: string | null;
  attainment: number;
  created_at: string;
  updated_at: string;
}
interface FieldRow extends RowDataPacket {
  id: string;
  kpi_id: string;
  label: string;
  value: string;
  position: number;
}
interface InitiativeRow extends RowDataPacket {
  id: string;
  kpi_id: string;
  title: string;
  done: number;
  position: number;
}
interface ActivityRow extends RowDataPacket {
  id: string;
  kpi_id: string;
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
  return then.toISOString().slice(0, 10);
}

function toField(r: FieldRow): KpiField {
  return { id: r.id, label: r.label, value: r.value };
}
function toInitiative(r: InitiativeRow): KpiInitiative {
  return { id: r.id, title: r.title, done: r.done === 1 };
}
function toActivity(r: ActivityRow): KpiActivity {
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
  initiatives: InitiativeRow[];
  activity: ActivityRow[];
}
function toKpi(k: KpiRow, c: Children): Kpi {
  return {
    id: k.id,
    name: k.name,
    source: k.source,
    priority: k.priority,
    status: k.status,
    owner: k.owner,
    auto: k.auto === 1,
    summary: k.summary ?? '',
    sourceDetail: k.source_detail ?? null,
    unit: k.unit ?? null,
    target: k.target ?? null,
    actual: k.actual ?? null,
    trend: k.trend,
    period: k.period ?? null,
    attainment: k.attainment,
    fields: c.fields.map(toField),
    initiatives: c.initiatives.map(toInitiative),
    activity: c.activity.map(toActivity),
  };
}

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, med: 2, low: 3 };

// ── Repository ──────────────────────────────────────────────────────────────
export const kpiRepo = {
  async findRow(tenantId: string, kpiId: string): Promise<KpiRow | null> {
    const rows = await query<KpiRow[]>('SELECT * FROM kpis WHERE id = :id AND tenant_id = :tid', { id: kpiId, tid: tenantId });
    return rows[0] ?? null;
  },

  async getById(tenantId: string, kpiId: string): Promise<Kpi | null> {
    const row = await this.findRow(tenantId, kpiId);
    if (!row) return null;
    const [fields, initiatives, activity] = await Promise.all([
      query<FieldRow[]>('SELECT * FROM kpi_fields WHERE kpi_id = :id ORDER BY position, id', { id: kpiId }),
      query<InitiativeRow[]>('SELECT * FROM kpi_initiatives WHERE kpi_id = :id ORDER BY position, id', { id: kpiId }),
      query<ActivityRow[]>('SELECT * FROM kpi_activity WHERE kpi_id = :id ORDER BY created_at DESC, id', { id: kpiId }),
    ]);
    return toKpi(row, { fields, initiatives, activity });
  },

  /** Lists every KPI for the tenant, fully hydrated, sorted by priority then name. */
  async listByTenant(tenantId: string): Promise<Kpi[]> {
    const kpis = await query<KpiRow[]>('SELECT * FROM kpis WHERE tenant_id = :tid', { tid: tenantId });
    if (kpis.length === 0) return [];
    const ids = kpis.map((k) => k.id);
    const placeholders = ids.map((_, i) => `:p${i}`).join(', ');
    const params: Record<string, unknown> = {};
    ids.forEach((kid, i) => (params[`p${i}`] = kid));

    const [fields, initiatives, activity] = await Promise.all([
      query<FieldRow[]>(`SELECT * FROM kpi_fields WHERE kpi_id IN (${placeholders}) ORDER BY position, id`, params),
      query<InitiativeRow[]>(`SELECT * FROM kpi_initiatives WHERE kpi_id IN (${placeholders}) ORDER BY position, id`, params),
      query<ActivityRow[]>(`SELECT * FROM kpi_activity WHERE kpi_id IN (${placeholders}) ORDER BY created_at DESC, id`, params),
    ]);
    const byKpi = <R extends { kpi_id: string }>(rows: R[]): Map<string, R[]> => {
      const m = new Map<string, R[]>();
      for (const r of rows) {
        const list = m.get(r.kpi_id);
        if (list) list.push(r);
        else m.set(r.kpi_id, [r]);
      }
      return m;
    };
    const fMap = byKpi(fields);
    const iMap = byKpi(initiatives);
    const aMap = byKpi(activity);

    const hydrated = kpis.map((k) =>
      toKpi(k, { fields: fMap.get(k.id) ?? [], initiatives: iMap.get(k.id) ?? [], activity: aMap.get(k.id) ?? [] }),
    );
    hydrated.sort((a, b) => {
      const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (pr !== 0) return pr;
      return a.name.localeCompare(b.name);
    });
    return hydrated;
  },

  async createManual(
    tenantId: string,
    input: { name: string; priority: Priority; unit?: string | null; target?: string | null; period?: string | null; owner: string; summary?: string | null },
  ): Promise<Kpi> {
    const kpiId = id('kpi');
    await withTransaction(async (conn) => {
      await conn.execute(
        `INSERT INTO kpis (id, tenant_id, name, source, priority, status, owner, auto, summary, unit, target, period)
         VALUES (:id, :tid, :name, 'manual', :priority, 'No data', :owner, 0, :summary, :unit, :target, :period)`,
        {
          id: kpiId, tid: tenantId, name: input.name, priority: input.priority, owner: input.owner,
          summary: input.summary ?? null, unit: input.unit ?? null, target: input.target ?? null, period: input.period ?? null,
        } as never,
      );
      await conn.execute(`INSERT INTO kpi_activity (id, kpi_id, who, act) VALUES (:id, :kid, :who, :act)`, {
        id: id('kact'), kid: kpiId, who: input.owner, act: 'created this KPI',
      } as never);
    });
    const created = await this.getById(tenantId, kpiId);
    if (!created) throw new Error('Failed to create KPI');
    return created;
  },

  async updateKpi(
    tenantId: string,
    kpiId: string,
    patch: {
      name?: string; priority?: Priority; status?: string; owner?: string; summary?: string;
      unit?: string | null; target?: string | null; actual?: string | null; trend?: KpiTrend;
      period?: string | null; attainment?: number;
    },
  ): Promise<boolean> {
    const r = await execute(
      `UPDATE kpis SET
         name = COALESCE(:name, name),
         priority = COALESCE(:priority, priority),
         status = COALESCE(:status, status),
         owner = COALESCE(:owner, owner),
         summary = COALESCE(:summary, summary),
         unit = IF(:unitSet, :unit, unit),
         target = IF(:targetSet, :target, target),
         actual = IF(:actualSet, :actual, actual),
         trend = COALESCE(:trend, trend),
         period = IF(:periodSet, :period, period),
         attainment = COALESCE(:attainment, attainment)
       WHERE id = :kid AND tenant_id = :tid`,
      {
        kid: kpiId, tid: tenantId,
        name: patch.name ?? null,
        priority: patch.priority ?? null,
        status: patch.status ?? null,
        owner: patch.owner ?? null,
        summary: patch.summary ?? null,
        unitSet: patch.unit !== undefined ? 1 : 0, unit: patch.unit ?? null,
        targetSet: patch.target !== undefined ? 1 : 0, target: patch.target ?? null,
        actualSet: patch.actual !== undefined ? 1 : 0, actual: patch.actual ?? null,
        trend: patch.trend ?? null,
        periodSet: patch.period !== undefined ? 1 : 0, period: patch.period ?? null,
        attainment: patch.attainment ?? null,
      },
    );
    return r.affectedRows > 0;
  },

  async deleteKpi(tenantId: string, kpiId: string): Promise<boolean> {
    const r = await execute('DELETE FROM kpis WHERE id = :kid AND tenant_id = :tid', { kid: kpiId, tid: tenantId });
    return r.affectedRows > 0;
  },

  // ── Initiatives (tasks) ────────────────────────────────────────────────────
  async setInitiativeDone(tenantId: string, initiativeId: string, done: boolean): Promise<boolean> {
    const r = await execute(
      `UPDATE kpi_initiatives ki JOIN kpis k ON k.id = ki.kpi_id
         SET ki.done = :done WHERE ki.id = :iid AND k.tenant_id = :tid`,
      { done: done ? 1 : 0, iid: initiativeId, tid: tenantId },
    );
    return r.affectedRows > 0;
  },
  async findInitiativeKpiId(tenantId: string, initiativeId: string): Promise<string | null> {
    const rows = await query<({ kpi_id: string } & RowDataPacket)[]>(
      `SELECT ki.kpi_id FROM kpi_initiatives ki JOIN kpis k ON k.id = ki.kpi_id WHERE ki.id = :iid AND k.tenant_id = :tid`,
      { iid: initiativeId, tid: tenantId },
    );
    return rows[0]?.kpi_id ?? null;
  },
  async addInitiative(tenantId: string, kpiId: string, title: string): Promise<boolean> {
    if (!(await this.findRow(tenantId, kpiId))) return false;
    await execute(
      `INSERT INTO kpi_initiatives (id, kpi_id, title, done, position)
       VALUES (:id, :kid, :title, 0, (SELECT COALESCE(MAX(position)+1,0) FROM kpi_initiatives ki WHERE ki.kpi_id = :kid))`,
      { id: id('kini'), kid: kpiId, title: title.slice(0, 255) },
    );
    return true;
  },
  async deleteInitiative(tenantId: string, initiativeId: string): Promise<boolean> {
    const r = await execute(
      `DELETE ki FROM kpi_initiatives ki JOIN kpis k ON k.id = ki.kpi_id WHERE ki.id = :iid AND k.tenant_id = :tid`,
      { iid: initiativeId, tid: tenantId },
    );
    return r.affectedRows > 0;
  },

  // ── Fields ─────────────────────────────────────────────────────────────────
  async addField(tenantId: string, kpiId: string, label: string, value: string): Promise<boolean> {
    if (!(await this.findRow(tenantId, kpiId))) return false;
    await execute(
      `INSERT INTO kpi_fields (id, kpi_id, label, value, position)
       VALUES (:id, :kid, :label, :value, (SELECT COALESCE(MAX(position)+1,0) FROM kpi_fields kf WHERE kf.kpi_id = :kid))`,
      { id: id('kfld'), kid: kpiId, label: label.slice(0, 80), value: value.slice(0, 200) },
    );
    return true;
  },
  async updateField(tenantId: string, fieldId: string, label: string, value: string): Promise<boolean> {
    const r = await execute(
      `UPDATE kpi_fields kf JOIN kpis k ON k.id = kf.kpi_id SET kf.label = :label, kf.value = :value
       WHERE kf.id = :fid AND k.tenant_id = :tid`,
      { fid: fieldId, tid: tenantId, label: label.slice(0, 80), value: value.slice(0, 200) },
    );
    return r.affectedRows > 0;
  },
  async deleteField(tenantId: string, fieldId: string): Promise<boolean> {
    const r = await execute(
      `DELETE kf FROM kpi_fields kf JOIN kpis k ON k.id = kf.kpi_id WHERE kf.id = :fid AND k.tenant_id = :tid`,
      { fid: fieldId, tid: tenantId },
    );
    return r.affectedRows > 0;
  },

  // ── Sources ────────────────────────────────────────────────────────────────
  async listSources(tenantId: string): Promise<ProjectSource[]> {
    const rows = await query<SourceRow[]>('SELECT * FROM kpi_sources WHERE tenant_id = :tid ORDER BY created_at, id', { tid: tenantId });
    return rows.map(toSource);
  },
  async findSourceRow(tenantId: string, sourceId: string): Promise<SourceRow | null> {
    const rows = await query<SourceRow[]>('SELECT * FROM kpi_sources WHERE id = :sid AND tenant_id = :tid', { sid: sourceId, tid: tenantId });
    return rows[0] ?? null;
  },
  async createSourceLinked(
    tenantId: string,
    input: { type: 'folder' | 'sheet' | 'doc'; name: string; externalId: string; webLink?: string | null; meta?: string | null },
  ): Promise<ProjectSource> {
    const sourceId = id('ksrc');
    const metaByType = { folder: 'Google Drive folder', sheet: 'Google Sheets', doc: 'Google Docs' };
    await execute(
      `INSERT INTO kpi_sources (id, tenant_id, type, name, meta, external_id, web_link, status)
       VALUES (:id, :tid, :type, :name, :meta, :ext, :link, 'linked')`,
      {
        id: sourceId, tid: tenantId, type: input.type, name: input.name.slice(0, 200),
        meta: input.meta ?? metaByType[input.type], ext: input.externalId, link: input.webLink ?? null,
      },
    );
    const created = await this.findSourceRow(tenantId, sourceId);
    if (!created) throw new Error('Failed to link KPI source');
    return toSource(created);
  },
  async deleteSource(tenantId: string, sourceId: string): Promise<boolean> {
    const r = await execute('DELETE FROM kpi_sources WHERE id = :sid AND tenant_id = :tid', { sid: sourceId, tid: tenantId });
    return r.affectedRows > 0;
  },
  async listSourceRows(tenantId: string): Promise<SourceRow[]> {
    return query<SourceRow[]>('SELECT * FROM kpi_sources WHERE tenant_id = :tid ORDER BY created_at, id', { tid: tenantId });
  },
  async setSourceStatus(tenantId: string, sourceId: string, status: 'linked' | 'scanning' | 'scanned'): Promise<void> {
    await execute('UPDATE kpi_sources SET status = :s WHERE id = :sid AND tenant_id = :tid', { s: status, sid: sourceId, tid: tenantId });
  },

  /** Creates (or refreshes) all KPIs distilled by AI from a single linked source. */
  async createFromExtractions(
    tenantId: string,
    source: { type: ProjectSourceType; name: string; externalId: string },
    list: {
      name: string; summary: string; priority: Priority; status: string; unit: string | null; target: string | null;
      actual: string | null; trend: KpiTrend; period: string | null; attainment: number;
      /** Stakeholder email, captured silently for People-linking — never shown/edited in the KPI UI. */
      ownerEmail?: string | null;
      fields: { label: string; value: string }[]; initiatives: { title: string }[];
    }[],
  ): Promise<void> {
    await withTransaction(async (conn) => {
      await conn.execute('DELETE FROM kpis WHERE tenant_id = :tid AND source_ref = :ref', { tid: tenantId, ref: source.externalId } as never);
      for (const ex of list) {
        const kpiId = id('kpi');
        await conn.execute(
          `INSERT INTO kpis
             (id, tenant_id, name, source, priority, status, owner, owner_email, auto, summary, source_detail, source_ref, unit, target, actual, trend, period, attainment)
           VALUES
             (:id, :tid, :name, :source, :priority, :status, 'IRIS', :ownerEmail, 1, :summary, :detail, :ref, :unit, :target, :actual, :trend, :period, :attn)`,
          {
            id: kpiId, tid: tenantId, name: ex.name.slice(0, 200), source: source.type, priority: ex.priority,
            status: ex.status.slice(0, 40), ownerEmail: ex.ownerEmail ?? null, summary: ex.summary,
            detail: `${source.type} · ${source.name}`, ref: source.externalId,
            unit: ex.unit, target: ex.target, actual: ex.actual, trend: ex.trend, period: ex.period, attn: ex.attainment,
          } as never,
        );
        for (let i = 0; i < ex.fields.length; i++) {
          const f = ex.fields[i]!;
          await conn.execute(`INSERT INTO kpi_fields (id, kpi_id, label, value, position) VALUES (:id, :kid, :label, :value, :pos)`, {
            id: id('kfld'), kid: kpiId, label: f.label, value: f.value, pos: i,
          } as never);
        }
        for (let i = 0; i < ex.initiatives.length; i++) {
          await conn.execute(`INSERT INTO kpi_initiatives (id, kpi_id, title, done, position) VALUES (:id, :kid, :title, 0, :pos)`, {
            id: id('kini'), kid: kpiId, title: ex.initiatives[i]!.title, pos: i,
          } as never);
        }
        await conn.execute(`INSERT INTO kpi_activity (id, kpi_id, who, act) VALUES (:id, :kid, 'IRIS', :act)`, {
          id: id('kact'), kid: kpiId, act: `extracted this KPI from ${source.name}`,
        } as never);
      }
    });
  },
};
