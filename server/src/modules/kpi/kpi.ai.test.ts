import { describe, expect, it } from 'vitest';
import { normalizeKpi } from './kpi.ai.js';

describe('normalizeKpi', () => {
  const base = { name: 'NDD network uptime', summary: 'Keeps last-mile delivery reliable.' };

  it('coerces a full KPI record', () => {
    const k = normalizeKpi(
      { ...base, priority: 'critical', status: 'At risk', unit: '%', target: '99.5%', actual: '98.2%', trend: 'down', period: 'Jun 2026', attainment: 74,
        fields: [{ label: 'Region', value: 'North' }], initiatives: [{ title: 'Add redundant link' }] },
      'Dashboard',
    );
    expect(k).toMatchObject({
      name: 'NDD network uptime', priority: 'critical', status: 'At risk', unit: '%', target: '99.5%',
      actual: '98.2%', trend: 'down', period: 'Jun 2026', attainment: 74,
    });
    expect(k.fields).toEqual([{ label: 'Region', value: 'North' }]);
    expect(k.initiatives).toEqual([{ title: 'Add redundant link' }]);
  });

  it('defaults invalid priority/trend and clamps attainment', () => {
    const k = normalizeKpi({ ...base, priority: 'urgent', trend: 'sideways', attainment: 250 }, 'Dashboard');
    expect(k.priority).toBe('med');
    expect(k.trend).toBe('flat');
    expect(k.attainment).toBe(100);
    const low = normalizeKpi({ ...base, attainment: -5 }, 'Dashboard');
    expect(low.attainment).toBe(0);
  });

  it('treats empty strings as null and falls back status/name', () => {
    const k = normalizeKpi({ name: '', summary: '', status: '', unit: '', target: '', actual: '', period: '' }, 'Q3 Metrics');
    expect(k.name).toBe('Q3 Metrics');
    expect(k.status).toBe('No data');
    expect(k.unit).toBeNull();
    expect(k.target).toBeNull();
    expect(k.actual).toBeNull();
    expect(k.period).toBeNull();
    expect(k.summary).toBe('Metric from Q3 Metrics.');
  });

  it('rounds a non-integer attainment', () => {
    expect(normalizeKpi({ ...base, attainment: 72.6 }, 'D').attainment).toBe(73);
  });
});
