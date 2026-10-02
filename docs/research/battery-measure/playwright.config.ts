// The config for docs/research/battery-measure/measure.spec.ts (mw-f758y.39). Not part of the gate:
//   npx vite build --minify false --outDir /tmp/postern-measure-dist --emptyOutDir
//   npx playwright test -c docs/research/battery-measure/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.MEASURE_PORT ?? 4797);
const extraLibDir = join(homedir(), '.cache', 'ms-playwright-system-libs', 'usr', 'lib', 'x86_64-linux-gnu');
const env = existsSync(extraLibDir) ? { ...process.env, LD_LIBRARY_PATH: [extraLibDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : undefined;

export default defineConfig({
  testDir: '.',
  testMatch: 'measure.spec.ts',
  timeout: 240_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Pixel 7'],
    channel: 'chromium',
    launchOptions: { env },
  },
  webServer: {
    command: `npx vite preview --outDir ${process.env.MEASURE_DIST ?? '/tmp/postern-measure-dist'} --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
