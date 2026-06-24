// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InsightView } from './InsightView';

describe('InsightView', () => {
  it('renders a structured artifact (KPI cards + markdown)', () => {
    const body = JSON.stringify({
      title: 'Yield',
      blocks: [
        { type: 'kpis', items: [{ label: 'Single-pass yield', value: '92%' }] },
        { type: 'markdown', text: 'Trending **up** week over week.' },
      ],
    });
    const { container } = render(<InsightView body={body} />);
    expect(container.textContent).toContain('Single-pass yield');
    expect(container.textContent).toContain('92%');
    expect(container.querySelector('strong')?.textContent).toBe('up');
  });

  it('renders a table block', () => {
    const body = JSON.stringify({
      title: 'T',
      blocks: [{ type: 'table', columns: ['Dept', 'Yield'], rows: [['Paint', '85%']] }],
    });
    const { container } = render(<InsightView body={body} />);
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.textContent).toContain('Paint');
  });

  it('falls back to markdown for non-JSON (legacy plain-text) bodies', () => {
    const { container } = render(<InsightView body={'plain **insight** text'} />);
    expect(container.querySelector('strong')?.textContent).toBe('insight');
  });

  it('renders nothing for an empty body', () => {
    const { container } = render(<InsightView body={null} />);
    expect(container.textContent).toBe('');
  });
});
