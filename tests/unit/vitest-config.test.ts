// @vitest-environment node
// mw-tfne4.37: overlapping gates on the desktop starve each other — vitest's
// default maxWorkers (availableParallelism() - 1) lets four concurrent gates
// spawn 60 forks on 16 cores, and the three tests that run a real vite build
// then miss their own timeouts. This proves the worker cap and the build
// tests' longer timeouts by reading source rather than re-running vitest
// inside vitest.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

describe('vitest.config.ts worker cap', () => {
  const source = readFileSync(path.join(process.cwd(), 'vitest.config.ts'), 'utf-8');

  it('caps maxWorkers at 4 so overlapping gates do not starve each other', () => {
    expect(source).toMatch(/maxWorkers:\s*4/);
  });
});

describe('real-build tests get a 120s timeout', () => {
  const buildTestFiles = [
    'tests/unit/vite-contract-decorators.test.ts',
    'tests/unit/vite-events-alias.test.ts',
    'tests/unit/pwa-precache.test.ts',
  ];

  it.each(buildTestFiles)('%s times out at 120_000ms, not its old shorter budget', (file) => {
    const source = readFileSync(path.join(process.cwd(), file), 'utf-8');
    expect(source).toMatch(/,\s*120_000\s*\);/);
    expect(source).not.toMatch(/,\s*(30_000|20_000|60_000)\s*\);/);
  });
});

// mw-5zn0f3: the 2026-10-13 gate lost a vitest fork ("Worker exited unexpectedly", no test failed)
// while two real vite builds (~2 GB each: pwa-precache in its worker, build-stamp-chunks in a child)
// ran side by side with 4 jsdom workers on a 12 GB host. The files that run a real build form their
// own vitest project, whose files run one at a time; every other test file stays in the main one.
describe('real-build test files run one at a time (mw-5zn0f3)', () => {
  type Project = { test?: { name?: string; include?: string[]; exclude?: string[]; fileParallelism?: boolean } };
  const loadProjects = async (): Promise<Project[]> => {
    const config = (await import('../../vitest.config')).default as unknown as { test?: { projects?: Project[] } };
    return config.test?.projects ?? [];
  };

  // Every test file that runs a real vite build: through vite's build() or a `vite build` child process.
  const runsARealBuild = (file: string): boolean => {
    const source = readFileSync(path.join(process.cwd(), file), 'utf-8');
    return /import\s*\{[^}]*\bbuild\b[^}]*\}\s*from\s*'vite'/.test(source) || /\.bin',\s*'vite'/.test(source);
  };

  const testFiles = (dir: string, suffix: RegExp): string[] =>
    readdirSync(path.join(process.cwd(), dir))
      .filter((f) => suffix.test(f))
      .map((f) => `${dir}/${f}`);

  const allFiles = [...testFiles('tests/unit', /\.test\.tsx?$/), ...testFiles('features/steps', /\.steps\.tsx?$/)];

  it('has a builds project that runs its files serially', async () => {
    const builds = (await loadProjects()).find((p) => p.test?.name === 'builds');
    expect(builds).toBeDefined();
    expect(builds?.test?.fileParallelism).toBe(false);
  });

  it('puts every file that runs a real vite build in the builds project, and only those', async () => {
    const builds = (await loadProjects()).find((p) => p.test?.name === 'builds');
    const listed = [...(builds?.test?.include ?? [])].sort();
    const real = allFiles.filter(runsARealBuild).sort();
    expect(real.length).toBeGreaterThanOrEqual(4);
    expect(listed).toEqual(real);
  });

  it('keeps every other test file in the main project, so none is dropped or run twice', async () => {
    const main = (await loadProjects()).find((p) => p.test?.name === 'main');
    expect(main).toBeDefined();
    // MW_TIMING=skip adds the rig's timing-test globs to exclude (pwa-kit/test-preset): those are not build files.
    const timingGlobs = (process.env.MW_TIMING === 'skip' ? (process.env.MW_TIMING_TESTS ?? '') : '').split(',').filter(Boolean);
    const excluded = [...(main?.test?.exclude ?? [])].filter((glob) => !timingGlobs.includes(glob));
    expect(excluded.sort()).toEqual(allFiles.filter(runsARealBuild).sort());
    expect(main?.test?.include).toEqual(
      expect.arrayContaining(['tests/unit/**/*.test.ts', 'features/steps/**/*.steps.ts']),
    );
  });
});
