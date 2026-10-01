// mw-gq6.208: two landings on one host each run `npm run gate:shots`; the e2e
// preview server must be per-worktree, not one fixed port that the second run
// reuses. The port is derived (not random) so Playwright's main process and
// its workers agree on it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { previewPort, reuseExistingPreview } from '../support/preview-port';

describe('previewPort', () => {
  it('is the same for the same worktree path, every time', () => {
    expect(previewPort('/home/a/.mw-worktrees/mw-1', {})).toBe(previewPort('/home/a/.mw-worktrees/mw-1', {}));
  });

  it('lies in 4400..5399, clear of spell-forge\'s 4173', () => {
    for (const p of ['/a', '/home/a/.mw-worktrees/mw-1', '/home/a/postern', '/x/y/z/w']) {
      const port = previewPort(p, {});
      expect(port).toBeGreaterThanOrEqual(4400);
      expect(port).toBeLessThan(5400);
    }
  });

  it('differs between different worktrees', () => {
    const ports = new Set(
      Array.from({ length: 8 }, (_, i) => previewPort(`/home/a/.mw-worktrees/mw-gq6.${200 + i}`, {})),
    );
    expect(ports.size).toBeGreaterThan(5);
  });

  it('takes PREVIEW_PORT from the environment when set', () => {
    expect(previewPort('/a', { PREVIEW_PORT: '4555' })).toBe(4555);
  });

  it('ignores a PREVIEW_PORT that is not a port number', () => {
    expect(previewPort('/a', { PREVIEW_PORT: 'abc' })).toBe(previewPort('/a', {}));
  });
});

describe('reuseExistingPreview', () => {
  it('is off unless PW_REUSE=1', () => {
    expect(reuseExistingPreview({})).toBe(false);
    expect(reuseExistingPreview({ CI: '1' })).toBe(false);
    expect(reuseExistingPreview({ PW_REUSE: '0' })).toBe(false);
    expect(reuseExistingPreview({ PW_REUSE: '1' })).toBe(true);
  });
});

describe('playwright.config.ts', () => {
  const source = readFileSync(path.join(process.cwd(), 'playwright.config.ts'), 'utf-8');

  it('hard-codes no port, and never reuses a server by default', () => {
    expect(source).not.toMatch(/4319/);
    expect(source).toMatch(/previewPort\(/);
    expect(source).toMatch(/reuseExistingPreview\(/);
    expect(source).not.toMatch(/reuseExistingServer:\s*!process\.env\.CI/);
  });
});
