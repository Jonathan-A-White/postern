// tests/e2e/long-options.spec.ts — mw-gq6.172: a decision card with three options of
// about 200 characters each, in a real 360 px browser (jsdom does no layout): the options
// stack as wrapped buttons taller than one line, and nothing in the conversation is wider
// than the viewport, so the page never scrolls sideways. One screenshot of the card.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';

test.use({ serviceWorkers: 'block', viewport: { width: 360, height: 780 } });

test('long decision options wrap as stacked buttons and nothing is wider than the screen', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor, undefined, { longOptions: true });
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();

  await page.goto('/?v=talk&t=bead%3Amw-2rbm.6');
  await expect(page.getByText('Q2: And when does the extraction happen?')).toBeVisible();
  await expect(page.getByText(/^Answered|answered:/).first()).toBeVisible();

  const list = page.getByTestId('conversation');
  const widths = await list.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, doc: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(widths.scroll).toBe(widths.client);
  expect(widths.doc).toBeLessThanOrEqual(widths.view);

  // The open card is the last one: its three option buttons are each taller than a one-line Button (h-8 = 32 px) and inside the viewport.
  const options = page.getByTestId('message').last().getByRole('button').filter({ hasText: /^[ABC]:/ });
  await expect(options).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const box = await options.nth(i).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(48);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(widths.view);
  }
  const chip = page.locator('span.inline-flex', { hasText: /answered:/ }).first();
  const chipBox = await chip.boundingBox();
  expect(chipBox!.x + chipBox!.width).toBeLessThanOrEqual(widths.view);

  await options.last().scrollIntoViewIfNeeded();
  await shot(page, 'long-option-card');
});
