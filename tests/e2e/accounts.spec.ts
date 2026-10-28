// tests/e2e/accounts.spec.ts — mw-9rp4hu.5: Settings > Accounts in a real browser against two stand-in backends.
// A second account is added by its backend's address with this phone's key, switched to from the top bar (its channels
// are its own), switched back (the first account's are as they were), renamed and removed. One screenshot of the section.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot, sized } from './shot';

test.use({ serviceWorkers: 'block', viewport: sized({ width: 390, height: 844 }) });

test('a second account is added by its backend, switched to and from, and removed', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governorKeyBytes = await deriveMasterKey(mnemonic);
  const governor = PrivateKey.fromHex(Buffer.from(governorKeyBytes).toString('hex'));
  await stubBackend(page, governor);
  await stubBackend(page, governor, undefined, { base: '/api-b', otherChannels: true });
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('need-card').first()).toBeVisible();

  // With one account the top bar names none.
  await page.goto('/?v=me');
  const accounts = page.getByRole('region', { name: 'Accounts' });
  await expect(accounts.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Account:/ })).toHaveCount(0);

  await accounts.getByRole('button', { name: 'Add account' }).click();
  await accounts.getByLabel('Backend address').fill(`${new URL(page.url()).origin}/api-b`);
  await accounts.getByLabel('Name').fill("Luke's factory");
  await expect(accounts.getByLabel("This phone's key")).toBeChecked();
  await accounts.getByRole('button', { name: 'Check and add' }).click();
  await expect(accounts.getByRole('status')).toContainText("Added “Luke's factory”. Its backend knows this key.");
  await expect(accounts.getByRole('listitem')).toHaveCount(2);
  await expect(accounts.getByRole('listitem', { name: 'Postern' })).toContainText('Active');
  await accounts.scrollIntoViewIfNeeded();
  await shot(page, 'accounts-section', accounts);

  // The top bar now names the account; its channels are the first account's.
  const chip = page.getByRole('button', { name: 'Account: Postern' });
  await expect(chip).toBeVisible();
  await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: /Channels/ }).click();
  const channels = page.getByTestId('thread-list');
  await expect(channels).toContainText('desktop move');
  await expect(channels).not.toContainText('luke garden');

  // Switch from the top bar: the second account's channels, none of the first's.
  await page.getByRole('button', { name: 'Account: Postern' }).click();
  await page.getByRole('menuitem', { name: "Luke's factory" }).click();
  await expect(page.getByRole('button', { name: "Account: Luke's factory" })).toBeVisible();
  await expect(channels).toContainText('luke garden');
  await expect(channels).toContainText('luke kitchen');
  await expect(channels).not.toContainText('desktop move');

  // And back: the first account is as it was.
  await page.getByRole('button', { name: "Account: Luke's factory" }).click();
  await page.getByRole('menuitem', { name: 'Postern' }).click();
  await expect(page.getByRole('button', { name: 'Account: Postern' })).toBeVisible();
  await expect(channels).toContainText('desktop move');
  await expect(channels).not.toContainText('luke garden');

  // Rename, then remove behind a confirm.
  await page.goto('/?v=me');
  await accounts.getByRole('button', { name: "Rename Luke's factory" }).click();
  await accounts.getByLabel('New name').fill('Luke');
  await accounts.getByRole('button', { name: 'Save name' }).click();
  await expect(accounts.getByRole('listitem', { name: 'Luke' })).toBeVisible();
  await accounts.getByRole('button', { name: 'Remove Luke' }).click();
  await accounts.getByRole('button', { name: 'Keep it' }).click();
  await expect(accounts.getByRole('listitem')).toHaveCount(2);
  await accounts.getByRole('button', { name: 'Remove Luke' }).click();
  await accounts.getByRole('button', { name: 'Yes, remove Luke' }).click();
  await expect(accounts.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Account:/ })).toHaveCount(0);

  const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(widths.doc).toBeLessThanOrEqual(widths.view);
});
