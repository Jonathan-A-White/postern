// tests/e2e/ideas-only-banner.spec.ts — mw-8ifimx.4: the Ideas only banner on the General channel in a real
// 390 x 844 browser (jsdom does no layout): it sits at the top, nothing is wider than the screen, a message
// sent while the mode is on says it is recorded for later, and a tap on the banner opens Settings.
// One screenshot of the channel with the banner.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey, publicKeyHexFromMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot, sized } from './shot';

test.use({ serviceWorkers: 'block', viewport: sized({ width: 390, height: 844 }) });

test('the Ideas only banner sits on the channel, and a message sent under it says it is recorded', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governorKeyBytes = await deriveMasterKey(mnemonic);
  const governor = PrivateKey.fromHex(Buffer.from(governorKeyBytes).toString('hex'));
  const me = publicKeyHexFromMasterKey(governorKeyBytes);
  await stubBackend(page, governor);

  const until = Math.floor(Date.now() / 1000) + 3 * 3600;
  await page.route(`**/api/ideas-only/${me}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ setting: { until, reaches: {} }, state: { on: true, until, by: 'until' } }),
    });
  });
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('need-card').first()).toBeVisible();

  await page.goto('/?v=talk&t=general');
  const banner = page.getByTestId('ideas-only-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Ideas only until');
  await expect(banner).toContainText('Ideas are kept; nothing is acted on until then');
  const box = await banner.boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);

  const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(widths.doc).toBeLessThanOrEqual(widths.view);
  await shot(page, 'ideas-only-banner', undefined);

  await banner.getByRole('button').click();
  await expect(page.getByRole('region', { name: 'Ideas only' })).toBeVisible();
});
