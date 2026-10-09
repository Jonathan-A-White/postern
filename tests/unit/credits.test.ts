// tests/unit/credits.test.ts — mw-vtjxh4.3: the credits are complete. A runtime
// dependency (package.json "dependencies", every module in server/go.mod) that no
// credit covers fails here, so adding a library means crediting it in the same commit.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CREDIT_GROUPS, allCredits, uncredited, goModules } from '../../src/credits';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };

describe('credits', () => {
  it('finds a dependency no credit covers', () => {
    expect(uncredited(['react', 'left-pad-9000'])).toEqual(['left-pad-9000']);
  });

  it('covers every runtime dependency in package.json', () => {
    expect(uncredited(Object.keys(pkg.dependencies))).toEqual([]);
  });

  it('covers every build and test dependency in package.json too', () => {
    expect(uncredited(Object.keys(pkg.devDependencies))).toEqual([]);
  });

  it('covers every module in server/go.mod, direct or indirect', () => {
    const modules = goModules(readFileSync('server/go.mod', 'utf-8'));
    expect(modules.length).toBeGreaterThan(0);
    expect(uncredited(modules)).toEqual([]);
  });

  it('gives every credit a name, a use, a licence, both links and the changes made', () => {
    for (const credit of allCredits()) {
      expect(credit.name, credit.name).not.toMatch(/^https?:|\.(com|org|io|dev)\/|^www\./);
      expect(credit.url, credit.name).toMatch(/^https:\/\/\S+$/);
      expect(credit.licenceUrl, credit.name).toMatch(/^https:\/\/\S+$/);
      expect(credit.use.length, credit.name).toBeGreaterThan(10);
      expect(credit.licence.length, credit.name).toBeGreaterThan(1);
      expect(credit.changes.length, credit.name).toBeGreaterThan(3);
    }
    expect(CREDIT_GROUPS.length).toBeGreaterThan(3);
  });

  it('names no credit twice', () => {
    const names = allCredits().map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('the About route', () => {
  it('round-trips as ?v=about, is a step down from Me', async () => {
    const { formatRoute, isDeep, parseRoute, topViewOf } = await import('../../src/nav/route');
    expect(formatRoute({ view: 'about' })).toBe('?v=about');
    expect(parseRoute('?v=about')).toEqual({ view: 'about' });
    expect(topViewOf({ view: 'about' })).toBe('me');
    expect(isDeep({ view: 'about' })).toBe(true);
  });
});
