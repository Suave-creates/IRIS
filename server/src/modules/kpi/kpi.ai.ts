import type Anthropic from '@anthropic-ai/sdk';
import type { KpiTrend, Priority } from '@iris/shared';
import { hasAnthropic } from '../../config/env.js';
import { complete, extractWithTool, systemBlocks } from '../../lib/anthropic.js';
import { logger } from '../../lib/logger.js';
// Reuse the generic sheet-parsing + stakeholder-chip helpers from the Projects extractor.
import { buildOwnerEmailByName, formatRecord, normalizeProjectName, pickHeader, type SheetTabInput } from '../projects/projects.ai.js';

export interface ExtractedKpi {
  name: string;
  summary: string;
  priority: Priority;
  status: string;
  unit: string | null;
  target: string | null;
  actual: string | null;
  trend: KpiTrend;
  period: string | null;
  /** 0–100, where 100 = target met (AI-estimated, direction-aware). */
  attainment: number;
  /** Stakeholder email from a source person-chip (silent People link); never shown in the KPI UI. */
  ownerEmail: string | null;
  fields: { label: string; value: string }[];
  initiatives: { title: string }[];
}

const KPI_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Concise metric name, e.g. "NDD network uptime"' },
    summary: { type: 'string', description: '1–2 crisp sentences: what the metric measures and why it matters' },
    priority: { type: 'string', enum: ['critical', 'high', 'med', 'low'], description: 'Importance of this KPI' },
    status: { type: 'string', description: 'One of: On track, At risk, Off track, Exceeded, No data' },
    unit: { type: 'string', description: 'Measurement unit if any, e.g. "%", "days", "M", "count". Empty string if none.' },
    target: { type: 'string', description: 'Target value as written, e.g. "99.5%", "≤ 2 days". Empty string if none stated.' },
    actual: { type: 'string', description: 'Latest actual/current value as written. Empty string if none stated.' },
    trend: { type: 'string', enum: ['up', 'down', 'flat'], description: 'Recent direction of the actual value' },
    period: { type: 'string', description: 'Review period, e.g. "Jun 2026", "Q3 FY26". Empty string if none.' },
    attainment: {
      type: 'integer',
      description:
        'Attainment against target on a 0–100 scale where 100 = target met or better. Be direction-aware ' +
        '(for "lower is better" metrics, closer-to-or-below target is higher attainment). 0 if unknown.',
    },
    fields: {
      type: 'array',
      description: '2–4 key facts as label/value pairs (exclude target/actual/unit/period — those have their own fields)',
      items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } }, required: ['label', 'value'] },
    },
    initiatives: {
      type: 'array',
      description: 'Up to 4 concrete initiatives/actions to move this metric',
      items: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    },
  },
  required: ['name', 'summary', 'priority', 'status', 'unit', 'target', 'actual', 'trend', 'period', 'attainment', 'fields', 'initiatives'],
};

const EXTRACT_TOOL: Anthropic.Tool = {
  name: 'record_kpis',
  description: 'Record every distinct KPI / metric distilled from the source content.',
  input_schema: {
    type: 'object',
    properties: {
      kpis: {
        type: 'array',
        description:
          'All distinct, real KPIs/metrics found in the source. A dashboard/tracker that lists many metrics ' +
          '(typically one per row) yields one entry per metric — never merge them. Ignore headers, totals, and ' +
          'empty or non-metric rows.',
        items: KPI_ITEM_SCHEMA,
      },
    },
    required: ['kpis'],
  },
};

const MAX_KPIS_PER_SOURCE = 150;
const SHEET_ROW_CHUNK = 14;
const MAX_SHEET_DATA_ROWS = 400;
const CHUNK_CONCURRENCY = 4;

const VALID_PRIORITY = new Set<Priority>(['critical', 'high', 'med', 'low']);
const VALID_TREND = new Set<KpiTrend>(['up', 'down', 'flat']);

function optText(raw: unknown, maxLen: number): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t ? t.slice(0, maxLen) : null;
}

/** Coerces one raw tool-emitted KPI object into a safe ExtractedKpi. */
export function normalizeKpi(raw: Record<string, unknown>, sourceName: string): ExtractedKpi {
  const priority = VALID_PRIORITY.has(raw.priority as Priority) ? (raw.priority as Priority) : 'med';
  const trend = VALID_TREND.has(raw.trend as KpiTrend) ? (raw.trend as KpiTrend) : 'flat';
  const fields = Array.isArray(raw.fields)
    ? (raw.fields as { label?: unknown; value?: unknown }[])
        .filter((f) => typeof f.label === 'string' && typeof f.value === 'string')
        .map((f) => ({ label: String(f.label).slice(0, 80), value: String(f.value).slice(0, 200) }))
    : [];
  const initiatives = Array.isArray(raw.initiatives)
    ? (raw.initiatives as { title?: unknown }[])
        .filter((t) => typeof t.title === 'string')
        .map((t) => ({ title: String(t.title).slice(0, 255) }))
    : [];
  const attainmentRaw = typeof raw.attainment === 'number' ? raw.attainment : Number(raw.attainment);
  const attainment = Number.isFinite(attainmentRaw) ? Math.max(0, Math.min(100, Math.round(attainmentRaw))) : 0;
  return {
    name: (typeof raw.name === 'string' && raw.name.trim()) || sourceName,
    summary: (typeof raw.summary === 'string' && raw.summary.trim()) || `Metric from ${sourceName}.`,
    priority,
    status: optText(raw.status, 40) ?? 'No data',
    unit: optText(raw.unit, 40),
    target: optText(raw.target, 80),
    actual: optText(raw.actual, 80),
    trend,
    period: optText(raw.period, 60),
    attainment,
    ownerEmail: null,
    fields,
    initiatives,
  };
}

function fallbackKpi(sourceName: string, content = ''): ExtractedKpi {
  return {
    name: sourceName,
    summary: content.replace(/\s+/g, ' ').trim().slice(0, 180) || `Metric from ${sourceName}.`,
    priority: 'med',
    status: 'No data',
    unit: null,
    target: null,
    actual: null,
    trend: 'flat',
    period: null,
    attainment: 0,
    ownerEmail: null,
    fields: [{ label: 'Source', value: sourceName }],
    initiatives: [],
  };
}

/** Distills every distinct KPI from (noisy) doc/folder content using Claude. */
export async function extractKpis(type: 'folder' | 'sheet' | 'doc', sourceName: string, content: string): Promise<ExtractedKpi[]> {
  if (!hasAnthropic || !content.trim()) return [fallbackKpi(sourceName, content)];
  try {
    const result = await extractWithTool<{ kpis?: unknown[] }>({
      system: systemBlocks(
        `You are IRIS, an executive chief-of-staff. The text below is the (often noisy) content of a linked ${type} named "${sourceName}". ` +
          `Identify EVERY distinct, real KPI/metric it describes and call record_kpis exactly once with all of them. ` +
          `Many sources are dashboards that list one metric per row — return one entry per metric and never merge them. ` +
          `For each metric capture the target, latest actual, unit, review period, a sensible status and priority, the recent trend, ` +
          `an attainment estimate (0–100, direction-aware), 2–4 key fields, and up to 4 initiatives to move it. ` +
          `If the source contains no real metric, return an empty kpis array.`,
      ),
      messages: [{ role: 'user', content: `Source: ${sourceName} (${type})\n\nContent:\n"""${content}"""` }],
      tool: EXTRACT_TOOL,
      maxTokens: 16000,
    });
    const raw = Array.isArray(result?.kpis) ? result!.kpis : [];
    const kpis = raw
      .filter((k): k is Record<string, unknown> => !!k && typeof k === 'object')
      .slice(0, MAX_KPIS_PER_SOURCE)
      .map((k) => normalizeKpi(k, sourceName));
    return kpis.length ? kpis : [fallbackKpi(sourceName, content)];
  } catch (err) {
    logger.warn({ err, sourceName }, 'kpi extraction failed — using fallback');
    return [fallbackKpi(sourceName, content)];
  }
}

async function runPooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  }
  return out;
}

interface KpiChunk {
  tab: string;
  headerLine: string;
  records: string;
  /** normalized metric name → stakeholder chip email, for this chunk's tab. */
  emailByName: Map<string, string>;
}

/** Extracts one KPI card PER ROW from a metrics dashboard sheet, across every tab. */
export async function extractKpisFromSheet(sourceName: string, tabs: SheetTabInput[]): Promise<ExtractedKpi[]> {
  const nonEmptyTabs = tabs.filter((t) => t.values.some((r) => r.some((c) => c.trim())));
  if (!hasAnthropic || nonEmptyTabs.length === 0) return [fallbackKpi(sourceName)];

  const chunks: KpiChunk[] = [];
  let usedRows = 0;
  for (const tab of nonEmptyTabs) {
    if (usedRows >= MAX_SHEET_DATA_ROWS) break;
    const { headerIdx, header } = pickHeader(tab.values);
    // Zip rows with their parallel chip-email row before filtering, to keep stakeholder emails aligned.
    const chipGrid = tab.chipEmails ?? [];
    const dataPairs = tab.values
      .slice(headerIdx + 1)
      .map((row, i) => ({ row, chips: chipGrid[headerIdx + 1 + i] ?? [] }))
      .filter(({ row }) => row.some((c) => c.trim()));
    if (dataPairs.length === 0) continue;
    const dataRows = dataPairs.map((p) => p.row);
    const emailByName = buildOwnerEmailByName(header, dataRows, dataPairs.map((p) => p.chips));
    const headerLine = header.map((h, i) => h.trim() || `Column ${i + 1}`).join(' | ');
    for (let i = 0; i < dataRows.length && usedRows < MAX_SHEET_DATA_ROWS; i += SHEET_ROW_CHUNK) {
      const slice = dataRows.slice(i, i + SHEET_ROW_CHUNK);
      usedRows += slice.length;
      const recs: string[] = [];
      slice.forEach((row, j) => {
        const rec = formatRecord(j + 1, header, row);
        if (rec) recs.push(rec);
      });
      if (recs.length) chunks.push({ tab: tab.title, headerLine, records: recs.join('\n'), emailByName });
    }
  }

  if (chunks.length === 0) {
    const text = nonEmptyTabs
      .map((t) => `## Tab: ${t.title}\n${t.values.map((r) => r.join(' | ')).join('\n')}`)
      .join('\n\n');
    return extractKpis('sheet', sourceName, text);
  }

  const perChunk = await runPooled(chunks, CHUNK_CONCURRENCY, async (chunk) => {
    try {
      const result = await extractWithTool<{ kpis?: unknown[] }>({
        system: systemBlocks(
          `You are IRIS, building KPI cards from a metrics dashboard named "${sourceName}" (tab "${chunk.tab}"). ` +
            `The columns of this tab are: ${chunk.headerLine}. Below are numbered records — EACH record is one row and ` +
            `represents ONE metric. Call record_kpis exactly once and emit ONE KPI per record that is a real metric. ` +
            `SKIP a record only if it is empty, a repeated header, or a section/subtotal/total row. ` +
            `Use the metric-name column for the name; read the target and latest actual from their columns; infer unit, period, ` +
            `status, priority and recent trend; estimate attainment 0–100 (direction-aware); add the 2–4 most useful columns as fields.`,
        ),
        messages: [{ role: 'user', content: chunk.records }],
        tool: EXTRACT_TOOL,
        maxTokens: 8000,
      });
      const raw = Array.isArray(result?.kpis) ? result!.kpis : [];
      return raw
        .filter((k): k is Record<string, unknown> => !!k && typeof k === 'object')
        .map((k) => normalizeKpi(k, sourceName))
        .map((k) => {
          // Link the real stakeholder chip email back to this KPI by name (never sent to the AI).
          const chipEmail = chunk.emailByName.get(normalizeProjectName(k.name));
          return chipEmail ? { ...k, ownerEmail: chipEmail } : k;
        });
    } catch (err) {
      logger.warn({ err, sourceName, tab: chunk.tab }, 'kpi sheet chunk extraction failed — skipping chunk');
      return [] as ExtractedKpi[];
    }
  });

  const kpis = perChunk.flat().slice(0, MAX_KPIS_PER_SOURCE);
  return kpis.length ? kpis : [fallbackKpi(sourceName)];
}

/** Writes a short AI summary for a manually-created KPI. */
export async function summarizeManualKpi(name: string, description?: string | null): Promise<string> {
  if (!hasAnthropic) return (description ?? '').slice(0, 280);
  try {
    const text = await complete({
      system: systemBlocks(
        'You are IRIS. Write a single crisp sentence (max 200 chars) describing what a business KPI measures and why it matters. No preamble, no quotes.',
      ),
      messages: [{ role: 'user', content: `KPI: ${name}${description ? `\nContext: ${description}` : ''}` }],
      maxTokens: 120,
    });
    return text.trim().slice(0, 280) || (description ?? '').slice(0, 280);
  } catch {
    return (description ?? '').slice(0, 280);
  }
}
