// tests/e2e/update-banner.spec.ts — mw-yxwtth.1: in a real browser with its real service worker, a
// newer build waits behind the one in control, the banner says 'Update ready, tap to reload', and one
// tap on it makes the new worker take over and the page reload once. The "newer build" is the built
// sw.js served with one more comment line, so the browser sees changed bytes and installs it. The
// line is added by an origin of the test's own (tests/support/build-origin.ts) because the browser's
// update check fetches sw.js where context.route does not see it (mw-qtu3zvz.49.21). The banner is raised only for a
// build whose changelog has a line after the running version (mw-6ww.175.34), so the changelog is routed with one.
import { test, expect } from '@playwright/test';
import { startBuildOrigin } from '../support/build-origin';
import { shot } from './shot';

test.use({ serviceWorkers: 'allow' });

test('a newer build waits, the banner shows, one tap loads it and the page reloads once', async ({ page, baseURL }) => {
  const changelog = [{ version: '99.1.0', date: '2026-12-01', story: 'a', kind: 'new', text: 'Pin a message to the top.' }];
  await page.route('**/changelog.json', (route) => route.fulfill({ json: changelog, headers: { 'cache-control': 'no-store' } }));
  const origin = await startBuildOrigin(baseURL!);
  try {
    const registration = () =>
      page.evaluate(async () => {
        const found = await navigator.serviceWorker.getRegistration();
        return { installing: Boolean(found?.installing), waiting: Boolean(found?.waiting) };
      });
    const bannerName = 'Update ready, tap to reload';
    const navigations: string[] = [];
    page.on('framenavigated', (frame) => frame.parentFrame() === null && navigations.push(frame.url()));

    await page.goto(origin.url + '/');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    // The browser is asked whether a newer build is up, and none is: nothing installing, nothing waiting, no banner.
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });
    await expect.poll(async () => (await registration()).installing).toBe(false);
    expect((await registration()).waiting).toBe(false);
    await expect(page.getByRole('button', { name: bannerName })).toHaveCount(0);

    // A newer build is up: the app finds out when it returns to the foreground.
    origin.setBuild(2);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const banner = page.getByRole('button', { name: bannerName });
    await expect(banner).toBeVisible({ timeout: 20_000 });
    expect((await registration()).waiting).toBe(true);
    await shot(page, 'update-banner');

    const before = navigations.length;
    await banner.click();
    await expect.poll(() => navigations.length, { timeout: 20_000 }).toBeGreaterThan(before);
    await expect(page.getByRole('button', { name: bannerName })).toHaveCount(0);
    // The page reloaded once, and the worker in control now is the new one.
    await page.waitForTimeout(1500);
    expect(navigations.length).toBe(before + 1);
    const scripts = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL);
    expect(scripts).toContain('/sw.js');
  } finally {
    await origin.close();
  }
});
