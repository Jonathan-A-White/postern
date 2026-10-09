// tests/e2e/about.spec.ts — mw-vtjxh4.3: About and credits in a real 412 px browser (jsdom does
// no layout): reached from Me, Newton's line first, a credit's name a link, and nothing wider
// than the screen, so no address or licence name pushes the page sideways. One screenshot.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';

test.use({ serviceWorkers: 'block', viewport: { width: 412, height: 860 } });

test('About opens from Me with the shoulders-of-giants line, then the credits, within the screen width', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor);
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('need-card').first()).toBeVisible();

  await page.goto('/?v=me');
  await page.getByRole('link', { name: /^About and credits/ }).click();
  await expect(page).toHaveURL(/v=about/);
  await expect(page.getByText('If I have seen further it is by standing on the shoulders of Giants.')).toBeVisible();
  await expect(page.getByText(/Isaac Newton, letter to Robert Hooke, 1675/)).toBeVisible();
  const whatsOnChain = page.getByTestId('credit-WhatsOnChain');
  await expect(whatsOnChain.getByRole('link', { name: 'WhatsOnChain', exact: true })).toHaveAttribute('href', 'https://whatsonchain.com');

  const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(widths.doc).toBeLessThanOrEqual(widths.view);
  await shot(page, 'about');
});
