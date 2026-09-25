// mw-tfne4.20: the Governor's decision — no zoom anywhere in the app. Reading
// index.html's source is the only way to prove the viewport meta disables
// user scaling without a real browser.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('index.html', () => {
  it('locks the viewport so the app cannot be zoomed (mw-tfne4.20)', () => {
    const html = readFileSync(path.join(process.cwd(), 'index.html'), 'utf-8');
    const meta = html.match(/<meta name="viewport" content="([^"]*)"/);
    expect(meta).not.toBeNull();
    const content = meta?.[1] ?? '';
    expect(content).toContain('width=device-width');
    expect(content).toContain('initial-scale=1.0');
    expect(content).toContain('viewport-fit=cover');
    expect(content).toContain('maximum-scale=1');
    expect(content).toContain('user-scalable=no');
  });
});
