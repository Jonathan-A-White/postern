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
});
