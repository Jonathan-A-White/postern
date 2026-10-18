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

  it('renders a link to this app\'s own origin, or a relative route, in place; any other origin opens a new tab (mw-t64a3.21)', () => {
    const own = `${window.location.origin}/?v=bead&id=mw-x`;
    render(<Markdown text={`[bead](${own}) and [needs](?v=needs) and [elsewhere](https://example.org/)`} />);

    for (const name of ['bead', 'needs']) {
      const link = screen.getByRole('link', { name });
      expect(link).not.toHaveAttribute('target');
    }
    expect(screen.getByRole('link', { name: 'bead' })).toHaveAttribute('href', own);
    expect(screen.getByRole('link', { name: 'needs' })).toHaveAttribute('href', '?v=needs');

    const other = screen.getByRole('link', { name: 'elsewhere' });
    expect(other).toHaveAttribute('target', '_blank');
    expect(other).toHaveAttribute('rel', 'noopener noreferrer');
  });

  // mw-ev7oyy.40: a link to another app (kindle:, tel:, sms:, intent:, mailto:) keeps its href, which the phone hands to
  // that app, and is not taken by the in-app router or opened in a blank tab. react-markdown's default url transform
  // blanks every scheme but http(s), mailto and a few more, so the href became '' and the tap re-opened this very page.
  it.each([
    'kindle://book?action=open&asin=B0C74TJ712',
    'intent://scan/#Intent;scheme=zxing;package=com.google.zxing.client.android;end',
    'tel:+15555550123',
    'sms:+15555550123?body=Hello',
    'smsto:+15555550123',
    'mailto:me@example.org?subject=Hi',
    'audible://library',
    'geo:0,0?q=Home',
  ])('keeps the href of %s and leaves the tap to the phone', (url) => {
    render(<Markdown text={`[Open](<${url}>)`} />);
    const link = screen.getByRole('link', { name: 'Open' });
    expect(link).toHaveAttribute('href', url);
    expect(link).not.toHaveAttribute('target');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(window.location.search).toBe('');
  });

  it('never keeps a link that runs script in this page', () => {
    const { container } = render(<Markdown text={'[a](javascript:alert(1)) [b](data:text/html,x) [c](vbscript:x)'} />);
    const anchors = Array.from(container.querySelectorAll('a'));
    expect(anchors).toHaveLength(3);
    for (const anchor of anchors) expect(anchor.getAttribute('href') ?? '').not.toMatch(/^\s*(javascript|data|vbscript):/i);
  });

  // mw-t64a3.23: a thread message's fenced block wraps its long lines (a phone is
  // 360 px wide); a document's keeps its horizontal scroll, as before.
  it('wraps a fenced block only when asked (thread messages), and a document keeps its scroll', () => {
    const long = `\`\`\`\n${'x'.repeat(120)}\n\`\`\``;
    const { container: thread } = render(<Markdown text={long} wrap />);
    expect(thread.querySelector('.markdown')).toHaveClass('markdown-wrap');
    const { container: document_ } = render(<Markdown text={long} />);
    expect(document_.querySelector('.markdown')).not.toHaveClass('markdown-wrap');
  });
});

// mw-tbx1n.11: every bead id in a message or card is a link to its page.
describe('Markdown bead ids', () => {
  it('turns each bead id in plain text into an in-app link to its page', () => {
    render(<Markdown text="see mw-6ww.48 and mw-yjxcw.5." />);

    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['mw-6ww.48', 'mw-yjxcw.5']);
    expect(links[0]).toHaveAttribute('href', '?v=bead&id=mw-6ww.48');
    expect(links[1]).toHaveAttribute('href', '?v=bead&id=mw-yjxcw.5');
    expect(links[0]).not.toHaveAttribute('target');
    expect(document.querySelector('.markdown')?.textContent).toBe('see mw-6ww.48 and mw-yjxcw.5.');
  });

  it('leaves an id inside code, a fenced block or an existing link as it is', () => {
    render(<Markdown text={'`mw-x` and [mw-y](https://example.com/mw-z) and https://example.com/mw-q\n\n```\nmw-w\n```'} />);

    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com/mw-z', 'https://example.com/mw-q']);
    expect(document.querySelector('code')?.textContent).toBe('mw-x');
  });

  it('links an id in a heading, list item, emphasis and table cell; not part of a longer word', () => {
    render(<Markdown text={'# mw-a1\n\n- **mw-b2.3**\n\n| x |\n| - |\n| mw-c4 |\n\nxmw-d5 and mw-e6-f and a/mw-g7'} />);

    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['mw-a1', 'mw-b2.3', 'mw-c4']);
  });
});
