import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { buildStampAt, buildVersion, shortCommit } from './build-version';

const MAIN_INCLUDE = [
  'tests/unit/**/*.test.ts',
  'tests/unit/**/*.test.tsx',
  'features/steps/**/*.steps.ts',
  'features/steps/**/*.steps.tsx',
];

// Every test file that runs a real vite build.
const BUILD_FILES = [
  'features/steps/build-stamp-chunks.steps.ts',
  'tests/unit/pwa-precache.test.ts',
  'tests/unit/vite-contract-decorators.test.ts',
  'tests/unit/vite-events-alias.test.ts',
];

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion(pkg.version, buildStampAt(), shortCommit())),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    globalSetup: ['./tests/global-setup.ts'],
    setupFiles: ['./tests/setup.ts'],
    // A handful of files run a real vite build (tests/unit/vite-*.test.ts,
    // pwa-precache.test.ts); running every worker at once on a shared host lets
    // those pile up and blow their own timeouts (mw-tfne4.33's landing failure).
    // Capping workers trades a little wall time for not timing out under load.
    maxWorkers: 4,
    // CPU-bound unit tests (real @bsv/sdk signing) pass the default 5 s on a loaded host:
    // mint-licence.test.ts refused mw-yjxcw.12's unrelated landing on 2026-09-30.
    testTimeout: 20_000,
    // bsv-kit/composer is run through vite, not loaded by node on its own, so a test can vi.mock one of
    // its inner modules (the voice recorder) and the package's own hold sees the double (mw-jtzpw0.2).
    server: { deps: { inline: ['bsv-kit'] } },
    projects: [
      { extends: true, test: { name: 'main', include: MAIN_INCLUDE, exclude: BUILD_FILES } },
      // The files that run a real vite build (~2 GB each: pwa-precache builds in its own worker, the
      // stamp-chunks scenario in child processes) run one at a time, so two builds never overlap each
      // other and four jsdom workers on a 12 GB host (the gate lost a fork, "Worker exited
      // unexpectedly", on 2026-10-13: mw-5zn0f3). tests/unit/vitest-config.test.ts keeps this list true.
      { extends: true, test: { name: 'builds', include: BUILD_FILES, fileParallelism: false } },
    ],
  },
});
