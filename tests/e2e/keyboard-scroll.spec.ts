// tests/e2e/keyboard-scroll.spec.ts — mw-jkrnxu.1: the document never scrolls. In the Factory channel
// on a 390x844 phone, with the update banner up and the composer focused (the keyboard's visual
// viewport is shorter than the layout), a new message scrolls the conversation inside its own box:
// html and body stay at scrollTop 0, the channel header and the composer stay in view.
import { test, expect, type Page } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });

async function scrollTops(page: Page): Promise<{ root: number; body: number; others: number[] }> {
  return page.evaluate(() => ({
    root: document.documentElement.scrollTop,
    body: document.body.scrollTop,
    // every element that is not the conversation's own scroll box (those carry overflow-y-auto)
    others: [...document.querySelectorAll<HTMLElement>('#root, #root *')]
      .filter((el) => el.scrollTop !== 0 && !el.className.toString().includes('overflow-y-auto'))
      .map((el) => el.scrollTop),
  }));
}

async function inFactoryChannelWithBanner(page: Page): Promise<void> {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor, undefined, { longThread: true });
  // The home goes down while the channel is open: 'Home is down' is a Shell banner like the update bar.
  let down = false;
  await page.route('**/api/view', (route) => (down ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ standby: true, home: 'desktop' }) }) : route.fallback()));
  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();

  await page.getByRole('link', { name: 'Channels' }).click();
  await page.getByRole('link', { name: /long thread/i }).first().click();
  await expect(page.getByText(/^Post 40:/)).toBeInViewport({ timeout: 30_000 });

  down = true;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('region', { name: 'Home is down' })).toBeVisible({ timeout: 30_000 });
}

/** Waits until the conversation's own box has been scrolled to its newest message (the effect under test has run). */
async function conversationAtBottom(page: Page): Promise<void> {
  const box = page.getByTestId('conversation').locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]');
  await expect.poll(() => box.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1);
}

async function sendFromComposer(page: Page): Promise<void> {
  const composer = page.getByPlaceholder('Message the Mayor…');
  await composer.focus();
  await composer.fill('Should we ship it?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Should we ship it?').last()).toBeVisible();
  await conversationAtBottom(page);
}

test('a new message with a banner up and the composer focused leaves the document at scrollTop 0', async ({ page }) => {
  await inFactoryChannelWithBanner(page);
  await sendFromComposer(page);
  await expect(page.getByText('Should we ship it?').last()).toBeInViewport();
  const tops = await scrollTops(page);
  expect(tops.root).toBe(0);
  expect(tops.body).toBe(0);
  expect(tops.others).toEqual([]);
  await expect(page.getByRole('heading', { name: 'long thread' })).toBeInViewport();
  await expect(page.getByPlaceholder('Message the Mayor…')).toBeInViewport();
  await shot(page, 'keyboard-scroll');
});

// Desktop Chromium cannot open a keyboard, so the keyboard's effect on Android Chrome (the layout stays
// 100dvh while the visible area shrinks, so the document has room to scroll further than it should) is
// made by hand: the layout is 324 px taller than the window. The browser scrolls to a focused box itself,
// so the document is put back at 0 before the send, and Ctrl+Enter sends without Playwright scrolling.
test('with the layout taller than the window, a new message still never scrolls the document', async ({ page }) => {
  await inFactoryChannelWithBanner(page);
  await page.evaluate(() => {
    for (const el of [document.documentElement, document.body, document.getElementById('root'), document.getElementById('root')?.firstElementChild]) {
      if (el instanceof HTMLElement) el.style.height = '1168px';
    }
  });
  const composer = page.getByPlaceholder('Message the Mayor…');
  await composer.focus();
  await composer.fill('Should we ship it?');
  await page.evaluate(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  });
  expect((await scrollTops(page)).root).toBe(0);
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('Should we ship it?').last()).toBeVisible();
  await conversationAtBottom(page);
  const tops = await scrollTops(page);
  expect(tops.root).toBe(0);
  expect(tops.body).toBe(0);
  expect(tops.others).toEqual([]);
});
