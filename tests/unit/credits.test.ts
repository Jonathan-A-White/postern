// tests/unit/credits.test.ts — mw-vtjxh4.3: the credits are complete. A runtime
// dependency (package.json "dependencies", every module in server/go.mod) that no
// credit covers fails here, so adding a library means crediting it in the same commit.
// mw-vtjxh4.13: and the other way round. A credit that covers a package or module no
// longer in package.json or server/go.mod fails (staleCovers), and every font or data file
// the app bundles (all of public/, plus font and data files under src/) must be named by a
// credit's `files`. A credit with no `covers` (an idea, a service, a standard) is not a
// package credit, so the stale check leaves it alone.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CREDIT_GROUPS, allCredits, uncredited, staleCovers, unnamedFiles, goModules } from '../../src/credits';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };

/** Every file under dir (repo-relative, forward slashes), optionally only those matching `only`. */
function filesUnder(dir: string, only?: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) return filesUnder(path, only);
    return !only || only.test(path) ? [path] : [];
  });
}

/** What the app bundles that is not code: everything in public/, and font or data files anywhere in src/. */
const BUNDLED_NON_CODE = /\.(woff2?|ttf|otf|eot|csv|tsv|json|ya?ml|txt|xml|wasm|onnx|bin|mp3|ogg|opus|wav|png|jpe?g|gif|webp|ico|svg)$/i;
const bundledFiles = (): string[] => [...filesUnder('public'), ...filesUnder('src', BUNDLED_NON_CODE)];

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

  it('finds a credit for a package that is no longer a dependency', () => {
    const everyCovered = allCredits().flatMap((c) => c.covers ?? []);
    const declared = everyCovered.filter((name) => name !== 'mermaid');
    expect(staleCovers(declared)).toEqual(['mermaid']);
    expect(staleCovers(everyCovered)).toEqual([]);
  });

  it('leaves credits that are not packages alone, however short the dependency list is', () => {
    const notPackages = allCredits().filter((c) => !c.covers);
    expect(notPackages.map((c) => c.name)).toEqual(expect.arrayContaining(['Beads', 'Web Push and VAPID', 'Go']));
    const stale = staleCovers([]);
    for (const credit of notPackages) expect(stale, credit.name).not.toContain(credit.name);
  });

  it('names no package that is not a dependency', () => {
    const modules = goModules(readFileSync('server/go.mod', 'utf-8'));
    const declared = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies), ...modules];
    expect(staleCovers(declared)).toEqual([]);
  });

  it('finds a bundled font or data file no credit names', () => {
    expect(unnamedFiles(['public/fonts/Lora.woff2', 'public/icon.svg'])).toEqual(['public/fonts/Lora.woff2']);
  });

  it('names every file the app bundles in public/ and every font or data file in src/', () => {
    const files = bundledFiles();
    expect(files).toContain('public/icon.svg');
    expect(unnamedFiles(files)).toEqual([]);
  });

  it('names no file that is no longer there', () => {
    const named = allCredits().flatMap((c) => c.files ?? []);
    expect(named.filter((file) => !existsSync(file))).toEqual([]);
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
