// tests/e2e/reopen-history.spec.ts — mw-f758y.41: close and reopen keeps his history. Two channels are
// opened, unsent words are typed in one and the other is scrolled; a fresh open of the bare address
// (page.goto('/'), as the home-screen icon does) brings back the words and the scroll, and Back walks
// to the channel before. A real 360 px browser, since jsdom does no layout.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';

test.use({ serviceWorkers: 'block', viewport: { width: 360, height: 640 } });

const WORDS = 'words I have not sent yet';

async function unlocked(page: Page): Promise<string> {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor, undefined, { longThread: true });
  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  return mnemonic;
}

function scrollerOf(inside: Locator): Locator {
  return inside.locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]');
}

test('close and reopen keeps the scroll and unsent text of each channel, and Back walks to the channel before', async ({ page }) => {
  await unlocked(page);

  // the long thread, scrolled into the middle
  await page.getByRole('link', { name: 'Channels' }).click();
  await page.getByRole('link', { name: /long thread/i }).first().click();
  await expect(page.getByText(/^Post 40:/)).toBeVisible({ timeout: 15_000 });
  const scroller = scrollerOf(page.getByTestId('conversation'));
  await scroller.evaluate(
    (box) =>
      new Promise<void>((resolve) => {
        box.scrollTop = (box.scrollHeight - box.clientHeight) * 0.4;
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  const before = await scroller.evaluate((box) => box.scrollTop);
  expect(before).toBeGreaterThan(100);

  // another channel, with words typed and not sent
  await page.getByRole('link', { name: 'Channels' }).click();
  await page.getByRole('link', { name: /Factory/i }).first().click();
  const box = page.getByRole('textbox', { name: 'Message' });
  await expect(box).toBeVisible();
  await box.fill(WORDS);
  await page.waitForTimeout(800);

  // closed and opened again at the home-screen icon's address
  await page.goto('/');
  await expect(page).toHaveURL(/v=talk/);
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(WORDS);
  await shot(page, 'reopen-history');

  // Back walks the screens he had been through (the list, then the long thread), scrolled where he left it
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Channels' })).toBeVisible();
  await page.goBack();
  await expect(page.getByText(/Post \d+:/).first()).toBeVisible({ timeout: 15_000 });
  const after = scrollerOf(page.getByTestId('conversation'));
  await expect.poll(() => after.evaluate((box) => box.scrollTop)).toBeGreaterThan(before - 40);
  expect(Math.abs((await after.evaluate((box) => box.scrollTop)) - before)).toBeLessThanOrEqual(40);
});
