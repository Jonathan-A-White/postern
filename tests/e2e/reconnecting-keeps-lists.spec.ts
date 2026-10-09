// tests/e2e/reconnecting-keeps-lists.spec.ts — mw-v1uyku.2: while the pill says Reconnecting…, nothing
// the phone already holds goes missing. The backend is cut, the app is opened again (a cold start with
// no connection), and the channel list, a channel's posts and Needs you are still there. A real 360 px
// browser, since the list is what he sees at phone width.
import { test, expect, type Page } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';

test.use({ serviceWorkers: 'block', viewport: { width: 360, height: 640 } });

// the pill while the backend is out of reach: Reconnecting… first, then Offline or the chain read (mw-t64a3.11)
const DOWN = /Reconnecting|Offline|Live from the chain/;

const CHANNELS = 5;

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

test('with the connection cut, the channel list, a channel and Needs you keep what the phone holds', async ({ page }) => {
  await unlocked(page);

  await page.getByRole('link', { name: 'Channels' }).click();
  const list = page.getByTestId('thread-list');
  await expect(list.getByText('Live view and the direct channel').or(list.getByText('mw-f758y.30.2')).first()).toBeVisible();
  // all five of the fixture's channels have arrived: Factory, four beads/named channels
  await expect(list.getByRole('listitem')).toHaveCount(CHANNELS);
  await expect(list.getByText('desktop move')).toBeVisible();

  // the connection is cut; the app is opened again with nothing answering
  await page.route('**/api/**', (route) => route.abort('connectionfailed'));
  await page.goto('/?v=talk');
  await expect(page.getByTestId('live-badge')).toHaveText(DOWN, { timeout: 20_000 });
  await expect(page.getByTestId('thread-list').getByRole('listitem')).toHaveCount(CHANNELS);
  await expect(page.getByTestId('thread-list').getByText('desktop move')).toBeVisible();
  await shot(page, 'reconnecting-keeps-lists');

  // a channel's own posts
  await page.getByTestId('thread-list').getByText('desktop move').click();
  await expect(page.getByTestId('conversation')).toContainText('The runbook is in');

  // and Needs you
  await page.getByRole('link', { name: 'Needs you' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  await expect(page.getByText('Where should the BSV library live?').first()).toBeVisible();
  await expect(page.getByTestId('live-badge')).toHaveText(DOWN);
});
