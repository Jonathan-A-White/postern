// @vitest-environment node
//
// features/steps/build-stamp-chunks.steps.ts — runs features/build-stamp-chunks.feature under vitest via
// @amiceli/vitest-cucumber: two real builds (each its own vite process) with the project's real vite.config.ts, the second a day
// later by POSTERN_BUILD_AT, and a look at what each put in dist/ (mw-7dige5.3).
import { afterAll, beforeAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

const run = promisify(execFile);

const feature = await loadFeature('features/build-stamp-chunks.feature');

const FIRST_AT = '2026-10-01T10:00:00Z';
const SECOND_AT = '2026-10-02T11:30:00Z';

interface Built {
  dir: string;
  files: string[];
  html: string;
  main: string;
  vendor: string;
}

function look(dir: string): Built {
  const files = readdirSync(path.join(dir, 'assets')).filter((f) => f.endsWith('.js')).sort();
  const html = readFileSync(path.join(dir, 'index.html'), 'utf-8');
  const main = /<script[^>]*type="module"[^>]*src="\/assets\/([^"]+\.js)"/.exec(html)?.[1] ?? '';
  const vendor = files.find((f) => f.startsWith('vendor-')) ?? '';
  return { dir, files, html, main, vendor };
}

// Each build is its own `vite build` process: one real build peaks near 2 GB, so two in the vitest
// worker's own heap ran it out of memory (the worker died, the whole gate with it).
async function buildAt(at: string, outDir: string): Promise<Built> {
  const vite = path.resolve(process.cwd(), 'node_modules', '.bin', 'vite');
  await run(vite, ['build', '--outDir', outDir, '--logLevel', 'silent'], {
    cwd: process.cwd(),
    env: { ...process.env, POSTERN_BUILD_AT: at },
    maxBuffer: 16 * 1024 * 1024,
  });
  return look(outDir);
}

let builds: Promise<[Built, Built]> | undefined;
const tmp = mkdtempSync(path.join(process.cwd(), 'node_modules', '.postern-stamp-chunks-'));

function bothBuilds(): Promise<[Built, Built]> {
  builds ??= (async () => {
    const first = await buildAt(FIRST_AT, path.join(tmp, 'a'));
    const second = await buildAt(SECOND_AT, path.join(tmp, 'b'));
    return [first, second] as [Built, Built];
  })();
  return builds;
}

// Two real builds outrun a step's 20 s: make them once, before any scenario.
beforeAll(() => bothBuilds(), 280_000);

const bytes = (b: Built, file: string) => readFileSync(path.join(b.dir, 'assets', file), 'utf-8');

describeFeature(feature, ({ Scenario }) => {
  // Two dist/ trees: on a loaded host a synchronous delete outran the default 10 s hook timeout and failed the gate.
  afterAll(() => rm(tmp, { recursive: true, force: true }), 120_000);

  Scenario('AC-1: two builds of the same commit at different times give the same main chunk and the same library chunk', ({ Given, Then, And, But }) => {
    Given('the app is built at one time and again at another time from the same code', async () => {
      await bothBuilds();
    });
    Then('the two builds list the same code files in dist/assets', async () => {
      const [a, b] = await bothBuilds();
      expect(a.main).not.toBe('');
      expect(a.vendor).not.toBe('');
      expect(b.files).toEqual(a.files);
      expect(b.main).toBe(a.main);
    });
    And('the main chunk and the library chunk have the same bytes in both', async () => {
      const [a, b] = await bothBuilds();
      expect(bytes(b, b.main)).toBe(bytes(a, a.main));
      expect(bytes(b, b.vendor)).toBe(bytes(a, a.vendor));
    });
    But('the page that carries the version stamp differs between them', async () => {
      const [a, b] = await bothBuilds();
      expect(b.html).not.toBe(a.html);
    });
  });

  Scenario('AC-2: the main chunk holds no build time and the libraries sit in a chunk of their own', ({ Given, Then, And }) => {
    Given('the app is built at one time and again at another time from the same code', async () => {
      await bothBuilds();
    });
    Then('the main chunk does not contain the build time', async () => {
      const [a, b] = await bothBuilds();
      for (const built of [a, b]) {
        const code = bytes(built, built.main);
        expect(code).not.toContain('2026-10-0');
        expect(code).not.toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}Z/);
      }
    });
    And('the library chunk holds React and does not import the main chunk', async () => {
      const [a] = await bothBuilds();
      const code = bytes(a, a.vendor);
      expect(code).toContain('react.transitional.element');
      expect(code).not.toContain(a.main);
    });
    And('the page carries the version stamp before the main chunk loads', async () => {
      const [a, b] = await bothBuilds();
      expect(a.html).toMatch(/__APP_VERSION__\s*=\s*"[^"]*2026-10-01 10:00Z[^"]*"/);
      expect(b.html).toMatch(/__APP_VERSION__\s*=\s*"[^"]*2026-10-02 11:30Z[^"]*"/);
      for (const built of [a, b]) {
        expect(built.html.indexOf('__APP_VERSION__')).toBeLessThan(built.html.indexOf(`/assets/${built.main}`));
      }
    });
  });

  Scenario('AC-3: the heavy lazy libraries stay lazy', ({ Given, Then, And }) => {
    Given('the app is built at one time and again at another time from the same code', async () => {
      await bothBuilds();
    });
    Then('the page does not preload the mermaid, elk or contract chunks', async () => {
      const [a] = await bothBuilds();
      expect(a.html).not.toMatch(/mermaid|elk|bsv-transaction/);
    });
    And('the library chunk does not contain mermaid', async () => {
      const [a] = await bothBuilds();
      expect(a.vendor.length).toBeGreaterThan(0);
      expect(bytes(a, a.vendor)).not.toContain('mermaid');
      expect(readFileSync(path.join(a.dir, 'assets', a.vendor)).length).toBeLessThan(1_500_000);
    });
  });
});
