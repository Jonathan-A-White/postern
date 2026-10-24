// tests/e2e/bottom-bar.spec.ts — mw-6yhrp1: the bottom bar ('Places') stays above the phone's own navigation bar. His phone: Android, Chrome,
// three-button navigation, 412x915. Headless Chromium has no system bar, so the test models the one thing the page can see of it: with
// viewport-fit=cover the page's window is the whole screen and the 48 px Back/Home/Recents bar is drawn over its foot with no inset reported
// (env(safe-area-inset-bottom) is 0 on his phone); without it the window is the screen less that bar. The viewport meta is read from the
// served page, so changing it changes what the test models. The bar's box must end at or above the system bar's top edge.
// (Same model as Legend's tests/e2e/bottom-bar.spec.ts, mw-jpxyd3.) The viewport is this spec's own, so it is not shot.
import { test, expect, type Page } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';

test.use({ serviceWorkers: 'block' });

const SCREEN = { width: 412, height: 915 };
const SYSTEM_BAR = 48;
const VISIBLE_BOTTOM = SCREEN.height - SYSTEM_BAR;

/** The window the page gets: the whole screen when its viewport meta says cover, else the screen less the system bar. */
async function windowFor(page: Page): Promise<void> {
  const html = await (await page.request.get('/')).text();
  const cover = /<meta[^>]+name="viewport"[^>]+viewport-fit=cover/.test(html);
  await page.setViewportSize({ width: SCREEN.width, height: cover ? SCREEN.height : VISIBLE_BOTTOM });
}

/** The page is told about the system bar through the safe-area inset (what Chrome does when it does report it). */
async function reportInset(page: Page, bottom: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom, left: 0, right: 0 } });
}

async function unlock(page: Page): Promise<void> {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor);
  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
}

const SCREENS: Array<[string, string]> = [
  ['Needs you', '/?v=needs'],
  ['To do', '/?v=todo'],
  ['Map (board)', '/?v=map&lens=board'],
  ['Map (graph)', '/?v=map&focus=mw-f758y.30&lens=graph'],
  ['Map (list)', '/?v=map&lens=list'],
  ['a bead', '/?v=bead&id=mw-f758y.30.2'],
  ['Channels', '/?v=talk'],
  ['a channel', '/?v=talk&t=general'],
  ['the Talk line', '/?v=line'],
  ['Search', '/?v=search&q=ping'],
  ['Me', '/?v=me'],
  ['Prompts', '/?v=prompts'],
  ['About', '/?v=about'],
  ['Key and licence', '/?v=key'],
  ['Archive', '/?v=archive'],
];

for (const reported of [0, 34, SYSTEM_BAR]) {
  test(`the Places bar is wholly above the phone navigation bar on every screen that shows it, with ${reported} px of bottom inset reported`, async ({ page }) => {
    await windowFor(page);
    if (reported > 0) await reportInset(page, reported);
    await unlock(page);
    for (const [name, url] of SCREENS) {
      await page.goto(url);
      const bar = page.getByRole('navigation', { name: 'Places' });
      await expect(bar, `${name}: the Places bar is shown`).toBeVisible();
      const box = (await bar.boundingBox())!;
      expect(box.y + box.height, `${name}: the bar's foot (px) against the system bar's top edge`).toBeLessThanOrEqual(VISIBLE_BOTTOM);
      // and the last tap target in it, not only its padding, is above the system bar
      const last = (await bar.getByRole('link').last().boundingBox())!;
      expect(last.y + last.height, `${name}: the Me tab's foot (px)`).toBeLessThanOrEqual(VISIBLE_BOTTOM);
    }
  });
}
