// tests/e2e/talk-settings.spec.ts — mw-06ggew.6: Me > Talk in a real 390 x 844 browser: the section sits after Connection and
// before Notifications, starts on Hold and On release, a choice stays after a reload, nothing is wider than the screen.
// One screenshot of the section.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot, sized } from './shot';

test.use({ serviceWorkers: 'block', viewport: sized({ width: 390, height: 844 }) });

test('Me has a Talk section: Hold and On release to begin with, a choice kept on the device', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governorKeyBytes = await deriveMasterKey(mnemonic);
  await stubBackend(page, PrivateKey.fromHex(Buffer.from(governorKeyBytes).toString('hex')));
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('need-card').first()).toBeVisible();

  await page.goto('/?v=me');
  const section = page.getByRole('region', { name: 'Talk' });
  await expect(section).toBeVisible();
  await expect(section.getByRole('radio', { name: 'Hold' })).toBeChecked();
  await expect(section.getByRole('radio', { name: 'On release' })).toBeChecked();
  const order = await page.evaluate(() => [...document.querySelectorAll('section[aria-label]')].map((s) => s.getAttribute('aria-label')));
  expect(order.indexOf('Connection')).toBeLessThan(order.indexOf('Talk'));
  expect(order.indexOf('Talk')).toBeLessThan(order.indexOf('Notifications'));

  await section.getByRole('radio', { name: 'Tap' }).check();
  await section.getByRole('radio', { name: 'By button' }).check();
  await page.reload();
  await expect(section.getByRole('radio', { name: 'Tap' })).toBeChecked();
  await expect(section.getByRole('radio', { name: 'By button' })).toBeChecked();

  const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(widths.doc).toBeLessThanOrEqual(widths.view);
  await shot(page, 'talk-settings', section);
});
