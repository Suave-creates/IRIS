// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chart } from './Chart';

const heights = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('rect')).map((r) => parseFloat(r.getAttribute('height') ?? '0'));

describe('Chart (bar)', () => {
  it('renders one bar per point', () => {
    const { container } = render(
      <Chart kind="bar" series={[{ name: 'FR0', points: [{ x: 'Mon', y: 10 }, { x: 'Tue', y: 20 }, { x: 'Wed', y: 30 }] }]} />,
    );
    expect(container.querySelectorAll('rect')).toHaveLength(3);
  });

  it('renders all-negative data correctly (regression: bars hang from a zero baseline, not inverted)', () => {
    const { container } = render(
      <Chart kind="bar" series={[{ name: 'Δ', points: [{ x: 'A', y: -10 }, { x: 'B', y: -20 }, { x: 'C', y: -30 }] }]} />,
    );
    const h = heights(container);
    expect(h).toHaveLength(3);
    // Larger magnitude → taller bar, and the smallest is not collapsed to a 1px sliver.
    expect(h[0]).toBeGreaterThan(2);
    expect(h[0]).toBeLessThan(h[1]!);
    expect(h[1]).toBeLessThan(h[2]!);
    // All negative bars share the same top (the zero baseline).
    const tops = Array.from(container.querySelectorAll('rect')).map((r) => r.getAttribute('y'));
    expect(new Set(tops).size).toBe(1);
  });

  it('shows an empty state when there is no usable data', () => {
    const { container } = render(<Chart kind="line" series={[]} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toContain('No chart data');
  });

  it('renders a line series as a polyline', () => {
    const { container } = render(
      <Chart kind="line" series={[{ name: 'trend', points: [{ x: 'Jan', y: 5 }, { x: 'Feb', y: 9 }] }]} />,
    );
    expect(container.querySelector('polyline')).toBeTruthy();
  });
});
