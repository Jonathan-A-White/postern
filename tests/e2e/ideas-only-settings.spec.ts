// tests/e2e/ideas-only-settings.spec.ts — mw-8ifimx.3: Settings > Ideas only in a real 390 x 844
// browser (jsdom does no layout): the section between Notifications and Voice, a preset turning it
// on against a stateful stand-in for GET/PUT /api/ideas-only/{key}, nothing wider than the screen.
// One screenshot of the section.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey, publicKeyHexFromMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot, sized } from './shot';

test.use({ serviceWorkers: 'block', viewport: sized({ width: 390, height: 844 }) });

test('the Ideas only section sits between Notifications and Voice, and a preset turns it on', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governorKeyBytes = await deriveMasterKey(mnemonic);
  const governor = PrivateKey.fromHex(Buffer.from(governorKeyBytes).toString('hex'));
  const me = publicKeyHexFromMasterKey(governorKeyBytes);
  await stubBackend(page, governor);

  let setting: { until: number; reaches: Record<string, boolean> } = { until: 0, reaches: {} };
  await page.route(`**/api/ideas-only/${me}`, async (route) => {
    if (route.request().method() === 'PUT') setting = route.request().postDataJSON() as typeof setting;
    const on = setting.until * 1000 > Date.now();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ setting, state: { on, until: on ? setting.until : 0, by: on ? 'until' : '' } }),
    });
  });
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('need-card').first()).toBeVisible();

  await page.goto('/?v=me');
  const section = page.getByRole('region', { name: 'Ideas only' });
  await expect(section.getByTestId('ideas-only-state')).toHaveText('Off');
  const order = await page.evaluate(() => [...document.querySelectorAll('section[aria-label]')].map((s) => s.getAttribute('aria-label')));
  expect(order.indexOf('Notifications')).toBeLessThan(order.indexOf('Ideas only'));
  expect(order.indexOf('Ideas only')).toBeLessThan(order.indexOf('Voice'));

  await section.getByRole('button', { name: 'For an hour' }).click();
  await expect(section.getByTestId('ideas-only-state')).toHaveText(/^On until \w{3} \d{2}:\d{2}$/);
  await expect(section.getByText('by the time you set')).toBeVisible();
  await expect(section.getByRole('button', { name: 'End now' })).toBeVisible();

  const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(widths.doc).toBeLessThanOrEqual(widths.view);
  await shot(page, 'ideas-only-settings', section);
});
