// mw-tfne4.15: an overflowing element (the Send screen's recipient key) left the
// body's default white showing beside the screens' slate-900 background. Reading
// the stylesheet's source is the only way to prove html/body carries the same
// background as the screens without a real browser layout.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('src/index.css', () => {
  it('gives html and body the same slate-900 background the screens use', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf-8');
    const rule = css.match(/html\s*,\s*\n?\s*body\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toContain('bg-slate-900');
  });

  it('gives every input and textarea a visible field style (mw-tfne4.19)', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf-8');
    const rule = css.match(/input\s*,\s*\n?\s*textarea\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule?.[1] ?? '';
    expect(body).toContain('border-slate-600');
    expect(body).toContain('bg-slate-800');
    expect(body).toContain('text-slate-100');
    expect(body).toContain('text-base');
  });

  it('sets touch-action manipulation on html so double-tap cannot zoom (mw-tfne4.20)', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf-8');
    const rule = css.match(/html\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toContain('touch-action: manipulation');
  });

  it('locks the document so it never scrolls or bounces (mw-tfne4.21)', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf-8');
    const rule = css.match(/html\s*,\s*\n?\s*body\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule?.[1] ?? '';
    expect(body).toContain('height: 100dvh');
    expect(body).toContain('overflow: hidden');
    expect(body).toContain('overscroll-behavior: none');
  });

  it('makes #root the one scroll container, sized to the viewport (mw-tfne4.21)', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf-8');
    const rule = css.match(/#root\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule?.[1] ?? '';
    expect(body).toContain('height: 100dvh');
    expect(body).toContain('overflow-y: auto');
  });
});
