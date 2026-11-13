// @vitest-environment node
//
// mw-7dige5.3: the build stamp is carried by the page (index.html), not by a chunk of code, so a build whose
// code is unchanged leaves the main chunk's bytes alone. buildStampPlugin writes it; POSTERN_BUILD_AT fixes
// the build time for a reproducible build.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStampAt, buildStampHtml, packageVersion } from '../../build-version';

afterEach(() => {
  delete process.env.POSTERN_BUILD_AT;
});

describe('buildStampAt', () => {
  it('is the time POSTERN_BUILD_AT names', () => {
    process.env.POSTERN_BUILD_AT = '2026-10-02T11:30:00Z';
    expect(buildStampAt().toISOString()).toBe('2026-10-02T11:30:00.000Z');
  });

  it('is now when it is unset or not a time', () => {
    const before = Date.now();
    expect(buildStampAt().getTime()).toBeGreaterThanOrEqual(before);
    process.env.POSTERN_BUILD_AT = 'nonsense';
    expect(Number.isNaN(buildStampAt().getTime())).toBe(false);
  });
});

describe('buildStampHtml', () => {
  it('sets window.__APP_VERSION__ to the version string, safe inside a script tag', () => {
    const html = buildStampHtml('0.6.5 · 2026-10-02 11:30Z · abc1234');
    expect(html).toBe('window.__APP_VERSION__="0.6.5 · 2026-10-02 11:30Z · abc1234";');
    expect(buildStampHtml('a</script><b')).not.toContain('</script');
  });
});

// mw-6ww.175.36: the live build said 0.8.111 beside commit b040268b whose package.json says 0.8.112, because
// the version was read from the working file, which a checkout that moved HEAD without rewriting the file
// (or a build begun before the bump reached the disk) leaves older than the commit the stamp names.
describe('packageVersion', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function checkout(): string {
    const dir = mkdtempSync(join(tmpdir(), 'version-stamp-'));
    dirs.push(dir);
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'ignore' });
    git('init', '-q');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.8.111' }));
    git('add', 'package.json');
    git('commit', '-q', '-m', 'one');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.8.112' }));
    git('commit', '-q', '-am', 'two');
    return dir;
  }

  it('is the version HEAD holds when the working package.json is older than HEAD', () => {
    const dir = checkout();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.8.111' }));
    expect(packageVersion(dir)).toBe('0.8.112');
  });

  it('is the working file version outside a git checkout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'version-stamp-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    expect(packageVersion(dir)).toBe('1.2.3');
  });
});
