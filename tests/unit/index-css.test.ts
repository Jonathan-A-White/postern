// mw-tfne4.15: an overflowing element (the Send screen's recipient key) left the
// body's default white showing beside the screens' slate-900 background. Reading
// the stylesheet's source is the only way to prove html/body carries the same
// background as the screens without a real browser layout.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('src/index.css', () => {
  it('gives html and body the same canvas background the screens use (mw-tfne4.15, plans/0021 tokens)', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf-8');
    const rule = css.match(/html\s*,\s*\n?\s*body\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toContain('background: var(--pc-canvas)');
    expect(css).toContain('--color-canvas: var(--pc-canvas)');
  });

  it('defines every token for dark and for light (plans/0021 decision 9)', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf-8');
    const dark = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';
    const light = css.match(/prefers-color-scheme: light\)\s*\{\s*:root\s*\{([^}]*)\}/)?.[1] ?? '';
    for (const token of ['canvas', 'surface', 'fg', 'muted', 'accent', 'needs', 'working', 'ready', 'blocked', 'held', 'done']) {
      expect(dark).toContain(`--pc-${token}:`);
      expect(light).toContain(`--pc-${token}:`);
    }
  });

  it('gives every input and textarea a visible field style (mw-tfne4.19)', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf-8');
    const rule = css.match(/input\s*,\s*textarea\s*,\s*select\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule?.[1] ?? '';
    expect(body).toContain('border-line');
    expect(body).toContain('bg-sunken');
    expect(body).toContain('text-fg');
    expect(body).toContain('text-base');
  });

  it('sets touch-action manipulation on html so double-tap cannot zoom (mw-tfne4.20)', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf-8');
    const rule = css.match(/html\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toContain('touch-action: manipulation');
  });

  it('locks the document so it never scrolls or bounces (mw-tfne4.21, mw-jkrnxu.2)', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf-8');
    const rule = css.match(/html\s*,\s*\n?\s*body\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule?.[1] ?? '';
    expect(body).toContain('height: 100dvh');
    // mw-jkrnxu.2: clip, not hidden: hidden still lets a focus or the keyboard scroll the box
    expect(body).toContain('overflow: clip');
    expect(body).toContain('overscroll-behavior: none');
  });

  it('sizes #root to the viewport; each screen scrolls its own panes (mw-tfne4.21, plans/0021)', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf-8');
    const rule = css.match(/#root\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule?.[1] ?? '').toContain('height: 100dvh');
  });

  it('gives a rendered Markdown block readable spacing for headings and lists (mw-hy6f4.1)', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf-8');
    const headingRule = css.match(/\.markdown h1,\s*\n?\s*\.markdown h2,\s*\n?\s*\.markdown h3\s*\{([^}]*)\}/);
    expect(headingRule).not.toBeNull();
    expect(headingRule?.[1] ?? '').toContain('font-semibold');

    const listRule = css.match(/\.markdown ul,\s*\n?\s*\.markdown ol\s*\{([^}]*)\}/);
    expect(listRule).not.toBeNull();
    const listBody = listRule?.[1] ?? '';
    expect(listBody).toContain('list-');
    expect(listBody).toContain('pl-');
  });

  it('gives a message list bottom padding that clears the home-indicator safe area (mw-tfne4.31)', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf-8');
    const rule = css.match(/\.message-list\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule?.[1] ?? '';
    expect(body).toContain('padding-bottom');
    expect(body).toContain('env(safe-area-inset-bottom)');
  });
});
