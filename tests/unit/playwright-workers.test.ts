// mw-6ww.175.69: mw hands a gate, an after-landing run and a Builder's test run JOBS (builder_jobs); Playwright
// reads its worker count only from the config, so playwright.config.ts must read JOBS. Unset, it leaves workers
// to Playwright's own default (half the cores), as before.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadWorkers(): Promise<number | undefined> {
  vi.resetModules();
  const mod = await import('../../playwright.config');
  return (mod.default as { workers?: number }).workers;
}

describe('playwright.config.ts workers', () => {
  beforeEach(() => {
    // Loading the config must not stop a preview or probe ports: reuse mode and a fixed port skip both.
    vi.stubEnv('PW_REUSE', '1');
    vi.stubEnv('PREVIEW_PORT', '4999');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('runs JOBS workers when JOBS is set', async () => {
    vi.stubEnv('JOBS', '2');
    expect(await loadWorkers()).toBe(2);
  });

  it("leaves workers to Playwright's own default when JOBS is not set", async () => {
    vi.stubEnv('JOBS', '');
    delete process.env.JOBS;
    expect(await loadWorkers()).toBeUndefined();
  });
});
