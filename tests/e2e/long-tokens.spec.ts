// tests/e2e/long-tokens.spec.ts — mw-jtzpw0.11: a bead channel whose comments hold a 64-hex txid, a long URL and a
// long code span, and whose question card is answered by a comment quoting a txid, in a real 390 px browser (jsdom
// does no layout): the thread never scrolls sideways and every token stays inside its bubble.
import { test, expect, type Page } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import type { Need } from '../../src/model/view';
import { shot } from './shot';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });

async function openChannel(page: Page, url: string, needs: Need[] = []) {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor, undefined, { longTokens: true, needs });
  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  await page.goto(url);
  await expect(page.getByText(/^Landed: 0f8d0ed2/)).toBeVisible();
  await expect(page.getByText(/whatsonchain\.com\/tx\//).first()).toBeVisible();
  await expect(page.getByTestId('conversation').getByRole('status').filter({ hasText: /^Answered: / })).toBeVisible();
}

async function expectNothingWide(page: Page) {
  const widths = await page.getByTestId('conversation').evaluate((list) => {
    let scroller: Element | null = list;
    while (scroller && scroller !== document.body && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    return { listScroll: list.scrollWidth, listClient: list.clientWidth, scroll: scroller?.scrollWidth ?? 0, client: scroller?.clientWidth ?? 0, doc: document.documentElement.scrollWidth, view: window.innerWidth };
  });
  expect(widths.listScroll).toBe(widths.listClient);
  expect(widths.scroll).toBe(widths.client);
  expect(widths.doc).toBeLessThanOrEqual(widths.view);

  // Everything a message draws sits inside its bubble.
  const bubbles = page.getByTestId('message');
  const count = await bubbles.count();
  expect(count).toBeGreaterThan(3);
  for (let i = 0; i < count; i++) {
    const escaped = await bubbles.nth(i).evaluate((el) => {
      const bubble = el.firstElementChild as HTMLElement;
      const b = bubble.getBoundingClientRect();
      return Array.from(bubble.querySelectorAll('*')).filter((node) => {
        const r = node.getBoundingClientRect();
        return r.width > 0 && (r.right > b.right + 1 || r.left < b.left - 1);
      }).map((node) => `${node.tagName}.${node.className}: ${node.textContent?.slice(0, 40)}`);
    });
    expect(escaped, `message ${i} draws outside its bubble`).toEqual([]);
  }
}

test('long unbroken tokens wrap inside their bubble and the bead channel never scrolls sideways', async ({ page }) => {
  await openChannel(page, '/?v=bead&id=mw-f758y.30.2');
  await expectNothingWide(page);
  await shot(page, 'long-tokens');
});

test('the same holds in the channel list view of the bead', async ({ page }) => {
  await openChannel(page, '/?v=talk&t=bead%3Amw-f758y.30.2');
  await expectNothingWide(page);
});

test('the answered line of a Needs you card stays inside its card', async ({ page }) => {
  const need: Need = {
    kind: 'question',
    bead: 'mw-f758y.30.2',
    epic: '',
    title: 'Live view and the direct channel',
    since: new Date(Date.now() - 120 * 60_000).toISOString(),
    text: 'Should the ping be 25 seconds?',
    recommended: 'Yes',
    options: ['Yes', 'No'],
    blocks: 0,
    steps: [],
  };
  await openChannel(page, '/?v=bead&id=mw-f758y.30.2', [need]);
  await page.goto('/?v=needs');
  const card = page.getByTestId('need-card').getByRole('status').filter({ hasText: /^Answered: / });
  await expect(card).toBeVisible();
  const outside = await card.evaluate((el) => {
    const view = window.innerWidth;
    return { doc: document.documentElement.scrollWidth, view, right: el.getBoundingClientRect().right, scroll: el.scrollWidth, client: el.clientWidth };
  });
  expect(outside.doc).toBeLessThanOrEqual(outside.view);
  expect(outside.right).toBeLessThanOrEqual(outside.view);
  expect(outside.scroll).toBe(outside.client);
});
