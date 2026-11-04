// mw-gq6.208: two landings on one host each run `npm run gate:shots`; the e2e
// preview server must be per-worktree, not one fixed port that the second run
// reuses. The port is derived (not random) so Playwright's main process and
// its workers agree on it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { portIsFree, previewPort, resolvePreviewPort, reuseExistingPreview } from '../support/preview-port';

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
    expect(source).toMatch(/resolvePreviewPort\(/);
    expect(source).toMatch(/reuseExistingPreview\(/);
    expect(source).not.toMatch(/reuseExistingServer:\s*!process\.env\.CI/);
  });
});

// mw-gq6.931: the hashed port is only where the search starts. A landing worktree has a random path, so
// it can hash onto a port something else holds (an orphan preview, a neighbour's server); `--strictPort`
// then stopped the whole gate ("Port 5205 is already in use"). The main process takes the next free
// port and hands it to Playwright's workers through PREVIEW_PORT, which they already honour.
describe('resolvePreviewPort', () => {
  it('uses the hashed port when it is free, as before', () => {
    const env: Record<string, string | undefined> = {};
    const asked: number[] = [];
    const port = resolvePreviewPort('/a', env, (p) => (asked.push(p), true));
    expect(port).toBe(previewPort('/a', {}));
    expect(asked).toEqual([port]);
  });

  it('takes the next free port when the hashed one is held', () => {
    const hashed = previewPort('/a', {});
    const env: Record<string, string | undefined> = {};
    expect(resolvePreviewPort('/a', env, (p) => p > hashed + 1)).toBe(hashed + 2);
  });

  it('wraps from the top of 4400..5399 to the bottom, and gives up when every port is held', () => {
    let top = '/a';
    for (let i = 0; previewPort(top, {}) !== 5399 && i < 200000; i += 1) top = `/w/${i}`;
    expect(previewPort(top, {})).toBe(5399);
    expect(resolvePreviewPort(top, {}, (p) => p !== 5399)).toBe(4400);
    expect(() => resolvePreviewPort('/a', {}, () => false)).toThrow(/no free port/i);
  });

  it('hands its choice to the workers through PREVIEW_PORT, which previewPort reads', () => {
    const hashed = previewPort('/a', {});
    const env: Record<string, string | undefined> = {};
    const chosen = resolvePreviewPort('/a', env, (p) => p !== hashed);
    expect(env.PREVIEW_PORT).toBe(String(chosen));
    // a worker loads the config again, with the main process's environment: same port, no search
    const worker = { ...env, TEST_WORKER_INDEX: '0' };
    expect(resolvePreviewPort('/a', worker, () => false)).toBe(chosen);
  });

  it('takes PREVIEW_PORT as given, without asking whether it is free', () => {
    expect(resolvePreviewPort('/a', { PREVIEW_PORT: '4555' }, () => false)).toBe(4555);
  });

  it('keeps the hashed port, held or not, when a person reuses their own server (PW_REUSE=1)', () => {
    const env: Record<string, string | undefined> = { PW_REUSE: '1' };
    expect(resolvePreviewPort('/a', env, () => false)).toBe(previewPort('/a', {}));
    expect(env.PREVIEW_PORT).toBeUndefined();
  });

  it('finds a port past one a real process is listening on', async () => {
    let cwd = '/b';
    let holder: net.Server | undefined;
    for (let i = 0; !holder && i < 50; i += 1) {
      cwd = `/held/${i}`;
      holder = await new Promise<net.Server | undefined>((resolve) => {
        const s = net.createServer();
        s.once('error', () => resolve(undefined));
        s.listen(previewPort(cwd, {}), '127.0.0.1', () => resolve(s));
      });
    }
    expect(holder).toBeDefined();
    try {
      const env: Record<string, string | undefined> = {};
      const port = resolvePreviewPort(cwd, env);
      expect(port).not.toBe(previewPort(cwd, {}));
      expect(port).toBeGreaterThanOrEqual(4400);
      expect(port).toBeLessThan(5400);
      expect(portIsFree(port)).toBe(true);
      expect(portIsFree(previewPort(cwd, {}))).toBe(false);
    } finally {
      await new Promise((resolve) => holder?.close(resolve));
    }
  });
});
