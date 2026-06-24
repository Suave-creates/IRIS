import { describe, expect, it } from 'vitest';
import { normalizeBlock, normalizeInsight } from './insight.js';

describe('normalizeBlock', () => {
  it('keeps a valid markdown block and drops an empty one', () => {
    expect(normalizeBlock({ type: 'markdown', text: 'Hello' })).toEqual({ type: 'markdown', text: 'Hello' });
    expect(normalizeBlock({ type: 'markdown', text: '   ' })).toBeNull();
  });

  it('coerces kpi values to strings and drops items missing label/value', () => {
    const block = normalizeBlock({
      type: 'kpis',
      items: [
        { label: 'Yield', value: 92 },
        { label: '', value: 'x' },
        { label: 'Volume', value: '12k', sub: 'WoW' },
      ],
    });
    expect(block).toEqual({
      type: 'kpis',
      items: [
        { label: 'Yield', value: '92', sub: null },
        { label: 'Volume', value: '12k', sub: 'WoW' },
      ],
    });
  });

  it('requires both columns and rows for a table', () => {
    expect(normalizeBlock({ type: 'table', columns: ['A'], rows: [['1']] })).toEqual({
      type: 'table',
      columns: ['A'],
      rows: [['1']],
    });
    expect(normalizeBlock({ type: 'table', columns: ['A'], rows: [] })).toBeNull();
  });

  it('keeps finite chart points, drops non-finite ones, defaults invalid chart type to bar', () => {
    const block = normalizeBlock({
      type: 'chart',
      chart: 'pie',
      series: [{ name: 'FR0', points: [{ x: 'Mon', y: 5 }, { x: 'Tue', y: 'NaN' }, { x: '', y: 3 }] }],
    });
    expect(block).toEqual({
      type: 'chart',
      chart: 'bar',
      title: null,
      xLabel: null,
      yLabel: null,
      series: [{ name: 'FR0', points: [{ x: 'Mon', y: 5 }] }],
    });
  });

  it('drops chart series with no usable points and unknown block types', () => {
    expect(normalizeBlock({ type: 'chart', series: [{ name: 'x', points: [] }] })).toBeNull();
    expect(normalizeBlock({ type: 'bogus' })).toBeNull();
    expect(normalizeBlock(null)).toBeNull();
  });
});

describe('normalizeInsight', () => {
  it('filters invalid blocks and falls back to the given title', () => {
    const insight = normalizeInsight(
      { blocks: [{ type: 'markdown', text: 'ok' }, { type: 'markdown', text: '' }, null] },
      'Fallback',
    );
    expect(insight.title).toBe('Fallback');
    expect(insight.blocks).toEqual([{ type: 'markdown', text: 'ok' }]);
  });

  it('uses a provided title and caps its length', () => {
    expect(normalizeInsight({ title: 'Q3 Yield', blocks: [] }, 'x').title).toBe('Q3 Yield');
    const long = normalizeInsight({ title: 'T'.repeat(200), blocks: [] }, 'x');
    expect(long.title.length).toBe(120);
  });

  it('returns empty blocks (not a throw) for malformed input', () => {
    expect(normalizeInsight(null, 'Details')).toEqual({ title: 'Details', blocks: [] });
  });
});
