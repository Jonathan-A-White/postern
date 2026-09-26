// tests/unit/markdown.test.tsx — mw-hy6f4.1: the shared Markdown component,
// GitHub-flavoured (remark-gfm) and never rendering raw HTML (no rehype-raw).
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Markdown } from '../../src/markdown';

const SAMPLE = `## A heading

- one
- two

**bold text** and a [link](https://example.com/page).

| A | B |
| --- | --- |
| 1 | 2 |

\`\`\`js
const x = 1;
\`\`\`
`;

describe('Markdown', () => {
  it('renders GFM markdown as formatted DOM (AC1)', () => {
    render(<Markdown text={SAMPLE} />);

    expect(screen.getByRole('heading', { level: 2, name: 'A heading' })).toBeInTheDocument();

    const list = screen.getByRole('list');
    expect(list.tagName).toBe('UL');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);

    expect(screen.getByText('bold text').tagName).toBe('STRONG');

    const link = screen.getByRole('link', { name: 'link' });
    expect(link).toHaveAttribute('href', 'https://example.com/page');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');

    expect(screen.getByRole('table')).toBeInTheDocument();

    const code = document.querySelector('pre code');
    expect(code).not.toBeNull();
    expect(code?.className).toContain('language-js');
  });

  it('renders HTML in a message as visible text, never as elements (AC2)', () => {
    render(<Markdown text={'<script>alert(1)</script> and <img onerror="alert(2)">'} />);

    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
  });
});
