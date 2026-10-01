// tests/e2e/answered-card.spec.ts — mw-f758y.32: a decision card he has answered goes dead
// and reads 'Answered: <option> HH:MM'; one screenshot of it, at 360 px.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';

test.use({ serviceWorkers: 'block', viewport: { width: 360, height: 780 } });

test('an answered decision card has dead options and says what he answered', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor, undefined, { longOptions: true });
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();

  await page.goto('/?v=talk&t=bead%3Amw-2rbm.6');
  const answered = page.getByTestId('message').filter({ hasText: 'Q1: Where should the shared core live?' });
  await expect(answered.getByRole('status')).toContainText(/^Answered: A: Move the core .* \d{2}:\d{2}( [AP]M)?$/);
  const options = answered.getByRole('button').filter({ hasText: /^[ABC]:/ });
  await expect(options).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(options.nth(i)).toBeDisabled();

  const open = page.getByTestId('message').filter({ hasText: 'Q2: And when does the extraction happen?' });
  await expect(open.getByRole('button').filter({ hasText: /^[ABC]:/ }).first()).toBeEnabled();

  await answered.scrollIntoViewIfNeeded();
  await shot(page, 'answered-card');
});
