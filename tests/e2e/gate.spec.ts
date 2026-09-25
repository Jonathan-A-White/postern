import { test, expect } from '@playwright/test';
import { shot } from './shot';

test('the gate loads and registers a service worker', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('The gate is locked')).toBeVisible();
  const swReady = await page.evaluate(() =>
    navigator.serviceWorker.ready.then(() => true),
  );
  expect(swReady).toBe(true);
  await shot(page, 'gate');
});
