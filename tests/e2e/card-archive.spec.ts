// tests/e2e/card-archive.spec.ts — mw-v1uyku.1: a live card three days old leaves Needs you for an
// 'Archived cards · 1' row; the row opens the archive list, where the card opens to its items. Two
// screenshots at the shots project's 390 px width, written by the spec (test-results/shots) and not committed.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });

test('a card untouched for 48 hours sits under Archived cards, and opens there', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor, undefined, { archivedCard: true });
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();

  const title = 'Done but still open: one tap each, any order, no rush';
  const row = page.getByRole('link', { name: 'Archived cards · 1' });
  await expect(row).toBeVisible();
  await expect(page.getByRole('article', { name: `Card: ${title}` })).toHaveCount(0);
  await row.scrollIntoViewIfNeeded();
  await shot(page, 'card-archive-needs');

  await row.click();
  await expect(page.getByRole('heading', { name: 'Archived cards' })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(`^${title}`) }).click();
  const card = page.getByRole('article', { name: `Card: ${title}` });
  await expect(card.getByTestId('live-card-item')).toHaveCount(2);
  await expect(card).toContainText('0 of 2 done');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, 'card-archive-list');
});
