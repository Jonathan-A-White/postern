// tests/e2e/scroll-back.spec.ts — mw-f758y.35: Back (and the tab bar) bring him back to where
// he was reading, not to the bottom of a thread. A real 360 px browser, since jsdom does no layout.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';

test.use({ serviceWorkers: 'block', viewport: { width: 360, height: 640 } });

async function unlocked(page: Page): Promise<void> {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor, undefined, { longThread: true });
  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
}

/** The scrolling box a locator sits in. */
function scrollerOf(inside: Locator): Locator {
  return inside.locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]');
}

/** The first post whose bottom is below the top of the scroller, and how far down it starts. */
async function topPost(scroller: Locator): Promise<{ text: string; offset: number }> {
  return scroller.evaluate((box) => {
    const top = box.getBoundingClientRect().top;
    for (const post of box.querySelectorAll('[data-testid="message"]')) {
      const rect = post.getBoundingClientRect();
      if (rect.bottom > top + 1) return { text: (post.textContent ?? '').slice(0, 12), offset: rect.top - top };
    }
    return { text: '', offset: 0 };
  });
}

async function scrollTo(scroller: Locator, fraction: number): Promise<void> {
  await scroller.evaluate(
    (box, f) =>
      new Promise<void>((resolve) => {
        box.scrollTop = (box.scrollHeight - box.clientHeight) * f;
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
    fraction,
  );
}

async function openLongThread(page: Page): Promise<Locator> {
  await page.getByRole('link', { name: 'Channels' }).click();
  await page.getByRole('link', { name: /long thread/i }).first().click();
  await expect(page.getByText(/^Post 40:/)).toBeVisible({ timeout: 15_000 });
  return scrollerOf(page.getByTestId('conversation'));
}

test('Back from Channels brings him to the post he was reading, not the newest', async ({ page }) => {
  await unlocked(page);
  const scroller = await openLongThread(page);
  await scrollTo(scroller, 0.4);
  const before = await topPost(scroller);
  expect(before.text).not.toBe('');
  expect(before.text).not.toMatch(/Post 40:/);

  await page.getByRole('link', { name: 'Channels' }).click();
  await expect(page.getByRole('heading', { name: 'Channels' })).toBeVisible();
  await page.goBack();

  const after = scrollerOf(page.getByTestId('conversation'));
  await expect(after).toBeVisible();
  await expect.poll(async () => (await topPost(after)).text).toBe(before.text);
  const now = await topPost(after);
  expect(Math.abs(now.offset - before.offset)).toBeLessThanOrEqual(40);
  await shot(page, 'scroll-back-thread');
});

test('the tab bar brings him back to where he scrolled on a screen', async ({ page }) => {
  await unlocked(page);
  await page.getByRole('link', { name: 'Me', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Me', exact: true })).toBeVisible();
  const body = page.locator('section:has(h1:text-is("Me")) div.overflow-y-auto').first();
  const room = await body.evaluate((box) => box.scrollHeight - box.clientHeight);
  expect(room).toBeGreaterThan(120);
  await scrollTo(body, 0.6);
  const before = await body.evaluate((box) => box.scrollTop);
  expect(before).toBeGreaterThan(60);

  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Search' })).toBeVisible();
  await page.getByRole('link', { name: 'Me', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Me', exact: true })).toBeVisible();

  await expect.poll(() => body.evaluate((box) => box.scrollTop)).toBeGreaterThan(before - 40);
  expect(Math.abs((await body.evaluate((box) => box.scrollTop)) - before)).toBeLessThanOrEqual(40);
});

test('a fresh open from a link still lands on the newest post of the thread', async ({ page }) => {
  await unlocked(page);
  await page.goto('/?v=talk&t=topic%3Along%20thread');
  await expect(page.getByText(/^Post 40:/)).toBeInViewport({ timeout: 15_000 });
});
