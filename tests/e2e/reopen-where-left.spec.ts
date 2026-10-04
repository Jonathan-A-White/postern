// tests/e2e/reopen-where-left.spec.ts — mw-f758y.31: Postern reopens where he left it. A bead
// page survives a reload, and a bare open (the home-screen icon's address, '/') lands on the
// last screen instead of the first.
import { test, expect, type Page } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';

test.use({ serviceWorkers: 'block', viewport: { width: 360, height: 640 } });

const BEAD = 'mw-f758y.30.2';

async function unlocked(page: Page): Promise<void> {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor);
  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
}

test('a bead page is still the bead page after a reload', async ({ page }) => {
  await unlocked(page);
  await page.getByRole('link', { name: 'Map', exact: true }).click();
  await page.goto(`/?v=bead&id=${BEAD}`);
  await expect(page.getByText('Acceptance criteria')).toBeVisible();

  await page.reload();

  await expect(page).toHaveURL(new RegExp(`v=bead&id=${BEAD.replace(/\./g, '\\.')}`));
  await expect(page.getByText('Acceptance criteria')).toBeVisible();
  await shot(page, 'reopen-bead');
});

test('a bare open lands on the last screen, not on Needs you', async ({ page }) => {
  await unlocked(page);
  await page.goto(`/?v=bead&id=${BEAD}`);
  await expect(page.getByText('Acceptance criteria')).toBeVisible();

  await page.goto('/');

  await expect(page.getByText('Acceptance criteria')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`v=bead&id=${BEAD.replace(/\./g, '\\.')}`));
  await page.getByRole('link', { name: 'Me', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Me', exact: true })).toBeVisible();

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Me', exact: true })).toBeVisible();
});

test('a link that names a place wins over the last screen', async ({ page }) => {
  await unlocked(page);
  await page.goto(`/?v=bead&id=${BEAD}`);
  await expect(page.getByText('Acceptance criteria')).toBeVisible();

  await page.goto('/?v=search');

  await expect(page.getByRole('heading', { name: 'Search' })).toBeVisible();
});
