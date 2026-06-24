import type Anthropic from '@anthropic-ai/sdk';
import type { InsightBlock, WhiteboardInsight } from '@iris/shared';

/**
 * Shared "render an insight" tool — lets Claude return a visual artifact (KPI cards,
 * tables, line/bar charts, prose) instead of plain text. Used by the Whiteboard's
 * cross-file AI and by Ask IRIS to attach infographics to answers.
 */
export const RENDER_INSIGHT_TOOL: Anthropic.Tool = {
  name: 'render_insight',
  description: 'Render an executive insight as an ordered mix of prose, KPI cards, tables, and charts.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short, specific title for the insight' },
      blocks: {
        type: 'array',
        description:
          'Ordered content blocks. Be visual: use a chart for trends (line) or comparisons across categories (bar); ' +
          'KPI cards for headline numbers; a table for structured records; markdown for commentary. ' +
          'Only use numbers that appear in the provided content — never invent data.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['markdown', 'kpis', 'table', 'chart'] },
            text: { type: 'string', description: 'Markdown body (when type=markdown)' },
            items: {
              type: 'array',
              description: 'KPI cards (when type=kpis)',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  value: { type: 'string' },
                  sub: { type: 'string', description: 'Optional sub-label, e.g. a delta or unit' },
                },
                required: ['label', 'value'],
              },
            },
            columns: { type: 'array', items: { type: 'string' }, description: 'Table header (when type=table)' },
            rows: {
              type: 'array',
              items: { type: 'array', items: { type: 'string' } },
              description: 'Table rows (when type=table)',
            },
            chart: { type: 'string', enum: ['line', 'bar'], description: 'Chart type (when type=chart)' },
            xLabel: { type: 'string' },
            yLabel: { type: 'string' },
            series: {
              type: 'array',
              description: 'Chart series (when type=chart)',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  points: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: { x: { type: 'string' }, y: { type: 'number' } },
                      required: ['x', 'y'],
                    },
                  },
                },
                required: ['name', 'points'],
              },
            },
          },
          required: ['type'],
        },
      },
    },
    required: ['title', 'blocks'],
  },
};

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/** Validates/normalizes one raw tool-emitted block; returns null if unusable. */
export function normalizeBlock(raw: unknown): InsightBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case 'markdown': {
      const text = asString(b.text).trim();
      return text ? { type: 'markdown', text } : null;
    }
    case 'kpis': {
      const items = Array.isArray(b.items)
        ? b.items
            .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
            .map((i) => ({
              label: asString(i.label).slice(0, 60),
              value: asString(i.value).slice(0, 40),
              sub: i.sub != null ? asString(i.sub).slice(0, 60) : null,
            }))
            .filter((i) => i.label && i.value)
        : [];
      return items.length ? { type: 'kpis', items } : null;
    }
    case 'table': {
      const columns = Array.isArray(b.columns) ? b.columns.map(asString) : [];
      const rows = Array.isArray(b.rows)
        ? b.rows.filter((r): r is unknown[] => Array.isArray(r)).map((r) => r.map(asString))
        : [];
      return columns.length && rows.length ? { type: 'table', columns, rows } : null;
    }
    case 'chart': {
      const chart = b.chart === 'line' || b.chart === 'bar' ? b.chart : 'bar';
      const series = Array.isArray(b.series)
        ? b.series
            .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
            .map((s) => ({
              name: asString(s.name) || 'Series',
              points: Array.isArray(s.points)
                ? s.points
                    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
                    .map((p) => ({ x: asString(p.x), y: Number(p.y) }))
                    .filter((p) => p.x !== '' && Number.isFinite(p.y))
                : [],
            }))
            .filter((s) => s.points.length > 0)
        : [];
      return series.length
        ? {
            type: 'chart',
            chart,
            title: b.title != null ? asString(b.title) : null,
            xLabel: b.xLabel != null ? asString(b.xLabel) : null,
            yLabel: b.yLabel != null ? asString(b.yLabel) : null,
            series,
          }
        : null;
    }
    default:
      return null;
  }
}

/** Coerces a raw render_insight tool result into a validated insight (blocks may be empty). */
export function normalizeInsight(raw: { title?: unknown; blocks?: unknown[] } | null, fallbackTitle: string): WhiteboardInsight {
  const rawBlocks = Array.isArray(raw?.blocks) ? raw!.blocks : [];
  const blocks = rawBlocks.map(normalizeBlock).filter((b): b is InsightBlock => b !== null);
  const title = (typeof raw?.title === 'string' && raw.title.trim()) || fallbackTitle;
  return { title: title.slice(0, 120), blocks };
}
