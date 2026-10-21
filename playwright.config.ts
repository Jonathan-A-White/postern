import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { playwrightTimeouts, playwrightTimingFilter } from 'pwa-kit/test-preset';
import { stopLeftoverPreview } from './scripts/preview-guard.mjs';
import { previewPort, reuseExistingPreview } from './tests/support/preview-port';
import { shotSize } from './tests/support/shot-size';

// One preview server per worktree: see tests/support/preview-port.ts.
const PREVIEW_PORT = previewPort(process.cwd());
const PREVIEW_BASE_URL = `http://localhost:${PREVIEW_PORT}`;

// A vite preview of this checkout left on the port by an earlier run would fail this one ("already
// used", mw-gq6.403): stop it as the main process loads the config. The workers load it too, while
// the run's own server is up, so they (TEST_WORKER_INDEX) and a person reusing a server (PW_REUSE) skip it.
if (process.env.TEST_WORKER_INDEX === undefined && !reuseExistingPreview()) stopLeftoverPreview(PREVIEW_PORT);

// This host's Chromium build needs libnspr4/libnss3/libasound2, which aren't
// installed system-wide here (no sudo). If a local copy has been unpacked to
// this well-known cache dir, point the dynamic linker at it; on a host that
// already has these libs, the directory is absent and this is a no-op.
const extraLibDir = join(homedir(), '.cache', 'ms-playwright-system-libs', 'usr', 'lib', 'x86_64-linux-gnu');
const browserEnv = existsSync(extraLibDir)
  ? { ...process.env, LD_LIBRARY_PATH: [extraLibDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') }
  : undefined;

// MW_TIMING=skip|only (the rig's timing tests: pwa-kit/test-preset) is read per project; no spec is tagged yet.
const timing = playwrightTimingFilter({ testMatch: ['**/*.spec.ts'] });

export default defineConfig({
  testDir: './tests/e2e',
  // pwa-kit/test-preset: a test's 60 s and expect()'s 20 s (its own wait is 5 s) on a loaded host (mw-40qzg4.1).
  ...playwrightTimeouts,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: PREVIEW_BASE_URL,
    trace: 'retain-on-failure',
  },
  // channel: 'chromium' uses the full Chromium browser build rather than Playwright's
  // default headless-shell binary, which this host does not have installed at all.
  projects: [
    {
      name: 'chromium',
      ...timing,
      use: { ...devices['Desktop Chrome'], channel: 'chromium', launchOptions: { env: browserEnv } },
    },
    // Used only by `npm run shots` (--project=shots): every e2e spec's screenshot
    // (tests/e2e/shot.ts) at the size scripts/run-shots.mjs is on (SHOT_SIZE), else a 390px iPhone width.
    {
      name: 'shots',
      ...timing,
      // The run after every landing, which publishes the shots, meets the host at its busiest: a worker starved while it
      // set a page up outran the preset's 60 s ("setting up page", key-vault, mw-gq6.684). Twice the preset's test budget.
      timeout: 2 * playwrightTimeouts.timeout,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        viewport: shotSize() ?? { width: 390, height: 844 },
        launchOptions: { env: browserEnv },
      },
    },
  ],
  webServer: {
    // Through the guard, so the server and what it started end with the run, Ctrl+C and timeout included.
    command: `node scripts/preview-guard.mjs ${PREVIEW_PORT} -- npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_BASE_URL,
    reuseExistingServer: reuseExistingPreview(),
    timeout: 60_000,
  },
});
