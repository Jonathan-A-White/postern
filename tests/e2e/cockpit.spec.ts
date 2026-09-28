// tests/e2e/cockpit.spec.ts — plans/0021: the cockpit end to end in a real
// browser against a stubbed v2 backend (docs/protocol.md §9–§15), from unlock to
// every place, with one screenshot per place at whatever width the project runs
// (390 px for `npm run shots`). The fixture is tests/support/cockpit-fixture.ts.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';

test.use({ serviceWorkers: 'block' });

test('the cockpit: unlock, needs, map, epic, bead, talk, search, me', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governorKeyBytes = await deriveMasterKey(mnemonic);
  const governor = PrivateKey.fromHex(Buffer.from(governorKeyBytes).toString('hex'));
  const { posted } = await stubBackend(page, governor);
  await seedVault(page, mnemonic);

  await page.goto('/');
  await shot(page, 'cockpit-unlock');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();

  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  await expect(page.getByTestId('need-card').first()).toContainText('Where should the BSV library live?');
  await expect(page.getByText('Unread from the Mayor')).toBeVisible();
  await shot(page, 'cockpit-needs');

  const hands = page.locator('article[aria-label^="Your hands:"]');
  await hands.getByRole('listitem', { name: 'Step linger' }).getByRole('button', { name: 'Approve and run' }).click();
  await hands.scrollIntoViewIfNeeded();
  await hands.screenshot({ path: 'test-results/shots/cockpit-hands.png' });
  await hands.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'New repo bsv-kit (recommended)' }).click();
  await expect.poll(() => posted.length).toBe(1);

  await page.goto('/?v=map');
  await expect(page.getByTestId('epic-card').first()).toBeVisible();
  await shot(page, 'cockpit-map');

  await page.goto('/?v=map&focus=mw-f758y.30&lens=board');
  await expect(page.getByTestId('board')).toBeVisible();
  await shot(page, 'cockpit-epic-board');

  await page.goto('/?v=map&focus=mw-f758y.30&lens=graph');
  await expect(page.getByTestId('graph')).toBeVisible();
  await shot(page, 'cockpit-epic-graph');

  await page.goto('/?v=bead&id=mw-f758y.30.2');
  await expect(page.getByText('Acceptance criteria')).toBeVisible();
  await expect(page.getByText('Make the ping interval 25 seconds', { exact: false })).toBeVisible();
  await shot(page, 'cockpit-bead');

  await page.goto('/?v=talk');
  await expect(page.getByTestId('thread-list')).toBeVisible();
  await shot(page, 'cockpit-talk');

  await page.goto('/?v=talk&t=general');
  await expect(page.getByText('Overnight', { exact: false })).toBeVisible();
  await shot(page, 'cockpit-thread');

  await page.goto('/?v=search&q=ping');
  await expect(page.getByTestId('hits-bead').or(page.getByTestId('hits-message')).first()).toBeVisible();
  await shot(page, 'cockpit-search');

  await page.goto('/?v=me');
  await expect(page.getByRole('heading', { name: 'Me' })).toBeVisible();
  await shot(page, 'cockpit-me');
});
