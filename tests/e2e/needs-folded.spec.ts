// tests/e2e/needs-folded.spec.ts — mw-ev7oyy.3: a verify card the Mayor folded (docs/protocol.md §11,
// `folded`) leaves the Needs you list for one closed line at the foot, 'Waiting on your use (N)'.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import type { Need } from '../../src/model/view';

test.use({ serviceWorkers: 'block' });

const since = new Date(Date.now() - 5 * 86_400_000).toISOString();
function verify(bead: string, title: string, extra: Partial<Need> = {}): Need {
  return { kind: 'verify', bead, epic: '', title, since, text: 'Open the page and look.', recommended: '', options: ['Verified'], blocks: 0, steps: [], waits_for: 'you', ...extra };
}

test('folded verify cards sit in one closed line at the foot, and a tap opens them', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governorKeyBytes = await deriveMasterKey(mnemonic);
  const governor = PrivateKey.fromHex(Buffer.from(governorKeyBytes).toString('hex'));
  await stubBackend(page, governor, undefined, { needs: [verify('mw-v.1', 'Fresh landing'), verify('mw-v.2', 'Old landing', { folded: true })] });
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();

  await expect(page.getByTestId('need-card').filter({ hasText: 'Fresh landing' })).toBeVisible();
  await expect(page.getByText('Old landing')).toHaveCount(0);
  const line = page.getByRole('button', { name: 'Waiting on your use (1)' });
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute('aria-expanded', 'false');

  await line.click();
  await expect(line).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('need-card').filter({ hasText: 'Old landing' })).toBeVisible();
});
