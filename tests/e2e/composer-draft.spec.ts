// tests/e2e/composer-draft.spec.ts — mw-gq6.250: what he is typing waits on the phone. Typed in a
// channel, it is back in the box after Lock now and an unlock, and after a reload; sent, a reload
// shows an empty box. No request, at any point, carries the words.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';

test.use({ serviceWorkers: 'block' });

const WORDS = 'a half-written thought for the Mayor';

test('a draft survives Lock now and a reload, is cleared by Send, and is never in a request', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governorKeyBytes = await deriveMasterKey(mnemonic);
  const governor = PrivateKey.fromHex(Buffer.from(governorKeyBytes).toString('hex'));
  const { posted } = await stubBackend(page, governor);
  await seedVault(page, mnemonic);

  // every request the page makes, with its body and address, for the "never sent" check
  const seen: string[] = [];
  page.on('request', (request) => seen.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`));

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('need-card').first()).toBeVisible();

  await page.goto('/?v=talk&t=general');
  const box = page.getByRole('textbox', { name: 'Message' });
  await expect(box).toHaveValue('');
  await box.fill(WORDS);
  await page.waitForTimeout(800);

  // Lock now, from Me, and unlock again: back in the channel, the words are in the box
  await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: /Me$/ }).click();
  await page.getByRole('button', { name: 'Lock now' }).click();
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Me', exact: true })).toBeVisible();
  await page.goBack();
  await expect(box).toHaveValue(WORDS);
  await shot(page, 'composer-draft');

  // a reload keeps them too
  await page.reload();
  await expect(box).toHaveValue(WORDS);

  // Send clears the draft: a reload shows an empty box
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(box).toHaveValue('');
  await expect.poll(() => posted.length).toBeGreaterThan(0);
  await page.reload();
  await expect(box).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Speak a message' })).toBeVisible();

  // the words went into the stored draft only: no request carries them, in the clear or in a record's body
  expect(seen.filter((line) => line.includes(WORDS) || line.includes(encodeURIComponent(WORDS)))).toEqual([]);
  expect(posted.filter((body) => body.includes(WORDS))).toEqual([]);
});
