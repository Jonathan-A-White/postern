import { test, expect } from '@playwright/test';

test('the key vault screen loads at ?screen=key', async ({ page }) => {
  await page.goto('/?screen=key');
  await expect(page.getByRole('heading', { name: 'The key vault' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate a new key' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore from a phrase' })).toBeVisible();
});
