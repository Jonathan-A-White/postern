// tests/e2e/needs-lists.spec.ts — mw-tbx1n.8: the Needs switch 'You · N | Mayor · N
// | Factory · N' in a real browser: the You list first, then the Mayor's, each with
// a screenshot (needs-you.png, needs-mayor.png) for `npm run shots`.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';
import type { Need } from '../../src/model/view';

test.use({ serviceWorkers: 'block' });

const since = new Date(Date.now() - 2 * 3_600_000).toISOString();
const NEEDS: Need[] = [
  {
    kind: 'hands',
    bead: 'mw-x.1',
    epic: 'mw-x',
    title: 'Merge the cockpit branch',
    since,
    text: 'The Mayor merges it once the tests are green.',
    recommended: '',
    options: [],
    blocks: 0,
    steps: [],
    waits_for: 'mayor',
  },
  {
    kind: 'demo',
    bead: 'mw-x.2',
    epic: 'mw-x',
    title: 'Show the new runner',
    since,
    text: '',
    recommended: '',
    options: [],
    blocks: 0,
    steps: [],
    not_ready: true,
    waiting_on: ['Build the runner'],
  },
];

test('the Needs switch: the You list, then the Mayor list, each with its shot', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governorKeyBytes = await deriveMasterKey(mnemonic);
  const governor = PrivateKey.fromHex(Buffer.from(governorKeyBytes).toString('hex'));
  await stubBackend(page, governor, undefined, { needs: NEEDS });
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();

  await expect(page.getByRole('tab', { name: 'Mayor · 1' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Factory · 1' })).toBeVisible();
  await expect(page.getByTestId('need-card').first()).toContainText('Where should the BSV library live?');
  await expect(page.getByText('Merge the cockpit branch')).toHaveCount(0);
  await shot(page, 'needs-you');

  await page.getByRole('tab', { name: 'Mayor · 1' }).click();
  await expect(page).toHaveURL(/who=mayor/);
  const card = page.getByTestId('need-card');
  await expect(card).toContainText('Waits on the Mayor');
  await expect(card.getByRole('button', { name: 'Done' })).toHaveCount(0);
  await shot(page, 'needs-mayor');
});
