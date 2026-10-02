// tests/e2e/update-banner.spec.ts — mw-yxwtth.1: in a real browser with its real service worker, a
// newer build waits behind the one in control, the banner says 'Update ready, tap to reload', and one
// tap on it makes the new worker take over and the page reload once. The "newer build" is the built
// sw.js served with one more comment line, so the browser sees changed bytes and installs it.
import { test, expect } from '@playwright/test';
import { shot } from './shot';

test.use({ serviceWorkers: 'allow' });

test('a newer build waits, the banner shows, one tap loads it and the page reloads once', async ({ page, context }) => {
  let build = 1;
  await context.route('**/sw.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n// build ${build}\n`, headers: { ...response.headers(), 'cache-control': 'no-store' } });
  });
  const navigations: string[] = [];
  page.on('framenavigated', (frame) => frame.parentFrame() === null && navigations.push(frame.url()));

  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect(page.getByRole('button', { name: 'Update ready, tap to reload' })).toHaveCount(0);

  // A newer build is up: the app finds out when it returns to the foreground.
  build = 2;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const banner = page.getByRole('button', { name: 'Update ready, tap to reload' });
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await shot(page, 'update-banner');

  const before = navigations.length;
  await banner.click();
  await expect.poll(() => navigations.length, { timeout: 20_000 }).toBeGreaterThan(before);
  await expect(page.getByRole('button', { name: 'Update ready, tap to reload' })).toHaveCount(0);
  // The page reloaded once, and the worker in control now is the new one.
  await page.waitForTimeout(1500);
  expect(navigations.length).toBe(before + 1);
  const scripts = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL);
  expect(scripts).toContain('/sw.js');
});
