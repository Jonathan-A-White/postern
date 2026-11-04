// tests/e2e/page-setup-watch.spec.ts — mw-gq6.936: the real thing the watch is for. A real browser is frozen (SIGSTOP), so
// a page setup truly waits on it, and the watch started in this worker by playwright.config.ts says what it waits on.
// No screenshot: nothing here is on a screen.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
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

/** The zygote this browser forks its renderers from: the one started without --no-zygote-sandbox. */
function rendererZygote(browserPid: number): number {
  const children = readFileSync(`/proc/${browserPid}/task/${browserPid}/children`, 'utf8').trim().split(/\s+/).map(Number);
  const zygote = children.find((pid) => {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    return cmdline.includes('--type=zygote') && !cmdline.includes('--no-zygote-sandbox');
  });
  if (zygote === undefined) throw new Error(`browser ${browserPid} has no renderer zygote`);
  return zygote;
}

/**
 * Stops every renderer the zygote forks for the next `ms`, as soon as it calls itself one, before it can answer a call. Blocks.
 * A child stopped sooner, while the zygote is still handing it over, makes Chrome call the launch failed: 'crashed'.
 */
function freezeNewRenderers(zygote: number, ms: number): number[] {
  const frozen: number[] = [];
  const until = Date.now() + ms;
  while (Date.now() < until) {
    for (const pid of readFileSync(`/proc/${zygote}/task/${zygote}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number)) {
      if (frozen.includes(pid)) continue;
      try {
        if (!readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('--type=renderer')) continue;
      } catch {
        continue;
      }
      process.kill(pid, 'SIGSTOP');
      frozen.push(pid);
    }
  }
  return frozen;
}

// mw-gq6.946: the after-landing shots of mw-gq6.931 lost two tests to page setups whose renderers were gone: every call
// unanswered, Inspector.detached the last word, no renderer in the tree, and Playwright 1.63 waited the whole 2 minutes.
// Chrome says 'Render process gone.' (and not 'crashed', which Playwright does handle) when it cannot read how a renderer
// ended; here the test kills its own browser's renderers and the zygote that would report them, mid-setup.
test('a page whose renderer is gone mid-setup: the setup ends within 45 s, and the watch says the target detached', async ({ playwright, browserName, channel, launchOptions }) => {
  test.setTimeout(150_000);
  const watch = pageSetupWatch()!;
  // The build the shots run on (channel 'chromium'), not the headless shell, which reports these renderers as crashed.
  const browser = await playwright[browserName].launch({ ...launchOptions, channel });
  const pid = watch.browserPid()!;
  const context = await browser.newContext();
  const zygote = rendererZygote(pid);
  try {
    process.kill(zygote, 'SIGSTOP');
    const started = Date.now();
    const setup = context.newPage().then(
      () => 'the page was set up',
      (error: Error) => error.message,
    );
    await expect.poll(() => watch.waitingOn()).toContain('Page.enable');
    process.kill(zygote, 'SIGCONT');
    const renderers = freezeNewRenderers(zygote, 1500);
    expect(renderers.length, 'the page asked for a renderer').toBeGreaterThan(0);
    renderers.forEach((renderer) => process.kill(renderer, 'SIGKILL'));
    process.kill(zygote, 'SIGKILL');
    const outcome = await Promise.race([
      setup,
      new Promise<string>((resolve) => setTimeout(() => resolve('the setup was still waiting at 45 s'), 45_000 - (Date.now() - started))),
    ]);
    expect(outcome).toContain("the page's target detached during its setup (Render process gone.)");
    expect(watch.said().at(-1)).toMatch(/page setup stopped after \d+ s: the page's target detached during its setup \(Render process gone\.\)/);
  } finally {
    await browser.close();
  }
});
