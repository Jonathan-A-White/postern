// tests/e2e/page-setup-watch.spec.ts — mw-gq6.936: the real thing the watch is for. A real browser is frozen (SIGSTOP), so
// a page setup truly waits on it, and the watch started in this worker by playwright.config.ts says what it waits on.
// No screenshot: nothing here is on a screen.
import { test, expect } from '@playwright/test';
import { pageSetupWatch } from '../support/page-setup-watch';

test('a frozen browser: the watch names the call the page setup is waiting on, and the frozen process', async ({ playwright, browserName }) => {
  const watch = pageSetupWatch();
  expect(watch, 'playwright.config.ts starts the watch in every worker').toBeDefined();
  const browser = await playwright[browserName].launch();
  const pid = watch!.browserPid();
  expect(pid).toBeGreaterThan(0);
  const context = await browser.newContext();
  process.kill(pid!, 'SIGSTOP');
  try {
    const setup = context.newPage();
    await expect.poll(() => watch!.waitingOn()).toContain('Target.createTarget');
    // The stop lands when the kernel next runs the browser, which on a loaded host is not at once.
    await expect.poll(() => watch!.describe()).toContain(`${pid} T`);
    const line = watch!.describe();
    expect(line).toContain('no answer to Target.createTarget');
    expect(line).toMatch(/load \d/);
    process.kill(pid!, 'SIGCONT');
    await setup;
  } finally {
    process.kill(pid!, 'SIGCONT');
    await browser.close();
  }
});
