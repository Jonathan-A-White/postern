import { test, expect } from '@playwright/test';

test('the live manifest identifies the app as Postern', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.name).toBe('Postern');
});

test('the live gate loads, installs, and opens offline', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByText('The gate is locked')).toBeVisible();

  const swReady = await page.evaluate(() =>
    navigator.serviceWorker.ready.then(() => true),
  );
  expect(swReady).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('The gate is locked')).toBeVisible();
});
