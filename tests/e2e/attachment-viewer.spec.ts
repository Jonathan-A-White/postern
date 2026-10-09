// tests/e2e/attachment-viewer.spec.ts — mw-jtzpw0.5: a tap on a picture attached in the composer
// opens it full screen; Close and the browser's Back both return to the channel with the picture
// still attached; the x still removes it.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';

test.use({ serviceWorkers: 'block' });

// a 2×2 red PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z8Dwn4GBgYEBAB8CAgFsrJ/LAAAAAElFTkSuQmCC', 'base64');

test('a tapped picture in the composer opens full screen; Close and Back return; the x removes', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governorKeyBytes = await deriveMasterKey(mnemonic);
  const governor = PrivateKey.fromHex(Buffer.from(governorKeyBytes).toString('hex'));
  await stubBackend(page, governor);
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('need-card').first()).toBeVisible();

  await page.goto('/?v=talk&t=general');
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: 'screenshot.png', mimeType: 'image/png', buffer: PNG });
  const thumbnail = page.getByRole('button', { name: 'View screenshot.png' });
  await expect(thumbnail).toBeVisible();

  // a tap on the picture opens it full screen, over the whole window
  await thumbnail.click();
  const viewer = page.getByRole('dialog', { name: 'Picture' });
  await expect(viewer).toBeVisible();
  const size = page.viewportSize();
  const box = await viewer.boundingBox();
  expect(box?.width).toBe(size?.width);
  expect(box?.height).toBe(size?.height);
  await expect(viewer.getByText('screenshot.png')).toBeVisible();
  await shot(page, 'attachment-viewer');

  // Close returns to the channel; the picture is still attached
  await viewer.getByRole('button', { name: 'Close picture' }).click();
  await expect(viewer).toBeHidden();
  await expect(thumbnail).toBeVisible();

  // so does Back, and it leaves the channel where it was
  await thumbnail.click();
  await expect(viewer).toBeVisible();
  await page.goBack();
  await expect(viewer).toBeHidden();
  await expect(thumbnail).toBeVisible();
  expect(page.url()).toContain('v=talk');

  // the x removes it and opens nothing
  await page.getByRole('button', { name: 'Remove screenshot.png' }).click();
  await expect(thumbnail).toBeHidden();
  await expect(viewer).toBeHidden();
});
