// tests/e2e/live-card.spec.ts — mw-nqur1n.11: a live card in Needs you under You, its items numbered with
// links to their beads, one ticked by the Mayor's update and one by an event the app held itself; one
// screenshot of it, at 360 px.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';

test.use({ serviceWorkers: 'block', viewport: { width: 360, height: 780 } });

test('a live card lists its items with links and ticks them off', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor, undefined, { liveCard: true });
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();

  const card = page.getByRole('article', { name: 'Card: Top 3 for this morning' });
  await expect(card).toBeVisible();
  const items = card.getByTestId('live-card-item');
  await expect(items).toHaveCount(3);
  // Item 1 ticked by the update, item 3 by the event the app held; item 2 is the one still to do, with its two links.
  await expect(items.nth(0)).toHaveAttribute('data-done', 'true');
  await expect(items.nth(2)).toHaveAttribute('data-done', 'true');
  await expect(items.nth(2).getByRole('status')).toContainText(/^Done \d{2}:\d{2}/);
  await expect(items.nth(1)).toHaveAttribute('data-done', 'false');
  await expect(items.nth(1).getByRole('link')).toHaveCount(2);
  await expect(card).toContainText('2 of 3 done');

  await card.scrollIntoViewIfNeeded();
  await shot(page, 'live-card');
});
