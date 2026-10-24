// tests/e2e/screen-stays-put.spec.ts — mw-jkrnxu.2: the page is never left scrolled. On a 390x844 phone,
// whatever the keyboard, the app switcher or a banner does, html, body and the Shell root sit at
// scrollTop 0, the Places bar keeps the 48 px floor of the phone's navigation bar (mw-6yhrp1) and the screen's heading is on screen. Under 1024 px
// the bar is the tab bar and its box ends 48 px above the window's foot; from 1024 px it is the sidebar, whose box runs to the window's foot and
// whose last thing, the live badge, ends 48 px above it (mw-iablds).
// A phone's keyboard and focus scroll cannot be made here, so before each action the page is pushed by
// hand the way they push it: a tall box inside body and the Shell root, and all three scrolled 300 px.
import { test, expect, type Page } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot, sized } from './shot';

test.use({ serviceWorkers: 'block', viewport: sized({ width: 390, height: 844 }) });

let down = false;

async function unlocked(page: Page): Promise<void> {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor);
  down = false;
  await page.route(/\/api\/view(\?|$)/, (route) => (down ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ standby: true, home: 'desktop' }) }) : route.fallback()));
  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
}

/** Gives html, body and the Shell root room to scroll and scrolls each 300 px, as a focus or a keyboard does. */
async function push(page: Page): Promise<void> {
  await page.evaluate(() => {
    const shell = document.getElementById('root')!.firstElementChild as HTMLElement;
    for (const el of [document.body, shell]) {
      el.style.position = 'relative';
      if (!el.querySelector(':scope > [data-pusher]')) {
        const tall = document.createElement('div');
        tall.setAttribute('data-pusher', '');
        tall.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:3000px;pointer-events:none;visibility:hidden';
        el.appendChild(tall);
      }
      el.scrollTop = 300;
    }
    window.scrollTo(0, 300);
    document.documentElement.scrollTop = 300;
  });
}

async function settled(page: Page, heading: string): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const shell = document.getElementById('root')!.firstElementChild as HTMLElement;
        return [document.scrollingElement?.scrollTop ?? 0, document.body.scrollTop, shell.scrollTop];
      }),
    )
    .toEqual([0, 0, 0]);
  const nav = await page.locator('nav[aria-label=Places]').evaluate((el) => ({
    bottom: el.getBoundingClientRect().bottom,
    badgeBottom: el.querySelector('[data-testid=live-badge]')?.getBoundingClientRect().bottom ?? null,
    inner: innerHeight,
    wide: matchMedia('(min-width: 1024px)').matches,
  }));
  if (nav.wide) {
    // The sidebar runs to the window's foot; the floor is the room under its last thing (the live badge).
    expect(nav.bottom).toBe(nav.inner);
    expect(nav.badgeBottom).toBe(nav.inner - 48);
  } else {
    // The tab bar's box ends 48 px above the window's foot: that strip is where the phone's own navigation bar may be drawn.
    expect(nav.bottom).toBe(nav.inner - 48);
  }
  const h1 = await page.getByRole('heading', { name: heading, level: 1 }).evaluate((el) => el.getBoundingClientRect().top);
  expect(h1).toBeGreaterThanOrEqual(0);
}

test('focusing, switching tabs, blurring, resizing and banners never leave the page scrolled', async ({ page }) => {
  await unlocked(page);

  // Search input focused
  await page.getByRole('link', { name: 'Search' }).click();
  await push(page);
  await page.getByPlaceholder('Search everything…').focus();
  await settled(page, 'Search');

  // switching tabs while the input is focused
  await push(page);
  await page.getByRole('link', { name: 'Channels' }).click();
  await settled(page, 'Channels');

  // the Channels screen's own field (New channel)
  await page.getByRole('button', { name: 'New channel' }).click();
  await push(page);
  await page.getByLabel('New channel').focus();
  await settled(page, 'Channels');

  // blurring
  await push(page);
  await page.getByLabel('New channel').blur();
  await settled(page, 'Channels');

  // the Composer, in the Factory channel
  await page.getByRole('link', { name: /factory/i }).first().click();
  const composer = page.getByPlaceholder('Message the Mayor…');
  await push(page);
  await composer.focus();
  await settled(page, 'Factory');
  await composer.blur();
  await settled(page, 'Factory');

  // coming back from the app switcher: visibilitychange, then resize
  await push(page);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await settled(page, 'Factory');
  await push(page);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await settled(page, 'Factory');

  // a banner mounting and unmounting
  await page.getByRole('link', { name: 'Channels' }).click();
  down = true;
  await push(page);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('region', { name: 'Home is down' })).toBeVisible({ timeout: 30_000 });
  await settled(page, 'Channels');
  down = false;
  await push(page);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('region', { name: 'Home is down' })).toHaveCount(0, { timeout: 30_000 });
  await settled(page, 'Channels');
  await shot(page, 'screen-stays-put');
});
