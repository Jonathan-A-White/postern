import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PREVIEW_PORT = 4319;
const PREVIEW_BASE_URL = `http://localhost:${PREVIEW_PORT}`;

// This host's Chromium build needs libnspr4/libnss3/libasound2, which aren't
// installed system-wide here (no sudo). If a local copy has been unpacked to
// this well-known cache dir, point the dynamic linker at it; on a host that
// already has these libs, the directory is absent and this is a no-op.
const extraLibDir = join(homedir(), '.cache', 'ms-playwright-system-libs', 'usr', 'lib', 'x86_64-linux-gnu');
const browserEnv = existsSync(extraLibDir)
  ? { ...process.env, LD_LIBRARY_PATH: [extraLibDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') }
  : undefined;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
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
      use: { ...devices['Desktop Chrome'], channel: 'chromium', launchOptions: { env: browserEnv } },
    },
    // Used only by `npm run shots` (--project=shots): a 390px iPhone width so
    // every e2e spec's end-of-test screenshot (tests/e2e/shot.ts) is taken at
    // phone size.
    {
      name: 'shots',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        viewport: { width: 390, height: 844 },
        launchOptions: { env: browserEnv },
      },
    },
  ],
  webServer: {
    command: `npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
