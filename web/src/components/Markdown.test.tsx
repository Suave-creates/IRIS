// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

describe('Markdown', () => {
  it('renders headings, bold, and GFM tables as real elements', () => {
    const md = '# Title\n\n**bold** text\n\n| A | B |\n| - | - |\n| 1 | 2 |';
    const { container } = render(<Markdown>{md}</Markdown>);
    expect(container.querySelector('h1')?.textContent).toContain('Title');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.querySelectorAll('td')).toHaveLength(2);
  });

  it('does not inject raw HTML from model output (skipHtml — XSS-safe)', () => {
    const { container } = render(
      <Markdown>{'<script>alert(1)</script> and <img src=x onerror=hack()>'}</Markdown>,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).not.toContain('hack()'); // attribute payload not present as executable
  });
});
