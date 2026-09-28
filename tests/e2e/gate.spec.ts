import { test, expect } from '@playwright/test';
import { shot } from './shot';

test('the door loads and registers a service worker', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Set up your key' })).toBeVisible();
  const swReady = await page.evaluate(() =>
    navigator.serviceWorker.ready.then(() => true),
  );
  expect(swReady).toBe(true);
  await shot(page, 'gate');
});
