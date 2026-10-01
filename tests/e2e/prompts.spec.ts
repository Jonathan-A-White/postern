// tests/e2e/prompts.spec.ts — mw-nqur1n.4: the Prompts screen in a real browser, from the
// Me screen's Prompts row: the list with its signature chips (prompts.png), Run landing in
// the general channel with '/top5 ' in the composer, Edit landing in 'prompt:top5' with the
// current body quoted above the composer.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';

test.use({ serviceWorkers: 'block' });

const PROMPTS = [
  {
    name: 'sweep',
    summary: 'Sweep a place',
    signature: [{ flag: '--who', type: 'string', required: true, help: 'whose place' }],
    body: 'Sweep {{who}}.',
    updatedAt: '2026-10-01T12:00:00Z',
    updatedBy: '02',
  },
  {
    name: 'top5',
    summary: 'The five things that matter',
    signature: [{ flag: '--duration', type: 'duration', default: '30m' }],
    body: 'List five things, shortest first.',
    updatedAt: '2026-10-01T12:00:00Z',
    updatedBy: '02',
  },
];

test('the Prompts screen lists the prompts; Run prefills the composer, Edit opens the channel with the body', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governorKeyBytes = await deriveMasterKey(mnemonic);
  const governor = PrivateKey.fromHex(Buffer.from(governorKeyBytes).toString('hex'));
  await stubBackend(page, governor);
  await page.route('**/api/prompts', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { ETag: '"v1"' }, body: JSON.stringify(PROMPTS) }));
  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();

  await expect(page.getByTestId('need-card').first()).toBeVisible();
  await page.goto('/?v=me');
  await page.getByRole('link', { name: /^Prompts/ }).click();
  await expect(page).toHaveURL(/v=prompts/);
  const top5 = page.getByTestId('prompt-top5');
  await expect(top5).toContainText('/top5');
  await expect(top5).toContainText('The five things that matter');
  await expect(top5.getByText('--duration 30m')).toBeVisible();
  await expect(page.getByTestId('prompt-sweep').getByText('--who')).toBeVisible();
  await shot(page, 'prompts');

  await top5.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('/top5 ');

  await page.goBack();
  await top5.getByRole('button', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/t=topic%3Aprompt%3Atop5/);
  await expect(page.getByTestId('prompt-current')).toContainText('Current /top5:');
  await expect(page.getByTestId('prompt-current')).toContainText('List five things, shortest first.');
});
