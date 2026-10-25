// tests/e2e/viewport-overflow.spec.ts — mw-gm81b4: no screen is wider than the window, after a resize or a full-screen switch.
// Wicket (a Postern-like app at his work) fitted in a windowed Chrome and ran past the right edge in full screen: message links cut
// mid-word, the composer's bar off the right, the Me tab off-screen, the Live pill gone. Every Postern screen (Channels, a channel,
// a thread, Search, Me) is read at both phone sizes and then through a resize 1280x800 -> 390x844 -> 1280x800 with NO reload. The
// shell clips what overflows (overflow-clip), so document.documentElement.scrollWidth stays honest even when a screen is wider than
// the window: the test also reads where the controls are. The viewport is this spec's own, so it is not shot.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { LONG_LINK_ROOT_TXID } from '../support/cockpit-fixture';
import { seedVault, stubBackend } from './cockpit-stub';

test.use({ serviceWorkers: 'block' });

/** `ready` names something the screen shows once its records are read, so a check never reads a screen still loading. */
type Screen = { name: string; url: string; pill: boolean; composer: boolean; ready?: (page: Page) => Locator };

const SCREENS: Screen[] = [
  { name: 'Needs you', url: '/?v=needs', pill: true, composer: false, ready: (page) => page.locator('article').first() },
  { name: 'To do', url: '/?v=todo', pill: true, composer: false },
  { name: 'Map', url: '/?v=map&lens=board', pill: true, composer: false },
  { name: 'Map (graph)', url: '/?v=map&focus=mw-f758y.30&lens=graph', pill: false, composer: false },
  { name: 'Map (list)', url: '/?v=map&lens=list', pill: true, composer: false },
  { name: 'a bead', url: '/?v=bead&id=mw-f758y.30.2', pill: false, composer: false, ready: (page) => page.getByRole('region', { name: 'Relations' }) },
  { name: 'the Talk line', url: '/?v=line', pill: false, composer: false },
  { name: 'Archive', url: '/?v=archive', pill: false, composer: false, ready: (page) => page.getByRole('heading', { name: 'Archived cards' }) },
  { name: 'Roadmap', url: '/?v=roadmap', pill: false, composer: false },
  { name: 'Prompts', url: '/?v=prompts', pill: false, composer: false },
  { name: 'About', url: '/?v=about', pill: false, composer: false },
  { name: 'Key and licence', url: '/?v=key', pill: false, composer: false },
  { name: 'Channels', url: '/?v=talk', pill: true, composer: false },
  { name: 'a channel', url: '/?v=talk&t=general', pill: false, composer: true },
  { name: 'a thread', url: `/?v=talk&t=general&r=${encodeURIComponent(LONG_LINK_ROOT_TXID)}`, pill: false, composer: true },
  { name: 'Search', url: '/?v=search&q=build', pill: true, composer: false },
  { name: 'Me', url: '/?v=me', pill: true, composer: false },
];

function screenUrl(name: string): string {
  return SCREENS.find((s) => s.name === name)!.url;
}

async function unlock(page: Page): Promise<void> {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor, undefined, { longLink: true, archivedCard: true });
  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
}

/** Open a screen by a move inside the app (no reload), as a tap on a link does. */
async function open(page: Page, url: string): Promise<void> {
  await page.evaluate((to) => {
    history.pushState({}, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, url);
}

/** Everything in the window that draws past its right or left edge, outside a box that scrolls sideways on purpose. */
async function pastTheEdge(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const view = window.innerWidth;
    const out: string[] = [];
    const offenders: Element[] = [];
    const scrollsSideways = (el: Element | null): boolean => {
      for (let up = el?.parentElement; up; up = up.parentElement) {
        if (['auto', 'scroll'].includes(getComputedStyle(up).overflowX) && up.scrollWidth > up.clientWidth) return true;
      }
      return false;
    };
    // sr-only text (a 1 px clipped box) is read aloud, never drawn.
    const clippedAway = (el: Element): boolean => {
      for (let up: Element | null = el; up; up = up.parentElement) {
        const r = up.getBoundingClientRect();
        if (r.width <= 1 && r.height <= 1 && getComputedStyle(up).overflow !== 'visible') return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll('#root *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden' || clippedAway(el)) continue;
      if ((r.right > view + 1 || r.left < -1) && !scrollsSideways(el)) {
        offenders.push(el);
        out.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} [${Math.round(r.left)}..${Math.round(r.right)}] "${(el.textContent ?? '').slice(0, 30)}"`);
      }
    }
    // The first offender's boxes up the tree, so a failure names the one that is too wide.
    const first = out.length > 0 ? offenders[0] : null;
    const up: string[] = [];
    for (let el: Element | null = first; el && el.id !== 'root' && up.length < 8; el = el.parentElement) {
      const r = el.getBoundingClientRect();
      up.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    }
    return [...out.slice(0, 8), ...(up.length > 0 ? [`  up: ${up.join(' < ')}`] : [])];
  });
}

async function insideWindow(page: Page, what: string, locator: ReturnType<Page['locator']>): Promise<void> {
  const view = page.viewportSize()!;
  // One read of every box together: a control re-rendered between two reads is not a box that fell out of the window.
  const boxes = await locator.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ x: r.x, width: r.width })));
  expect(boxes.length, `${what}: is on the screen`).toBeGreaterThan(0);
  boxes.forEach((box, i) => {
    expect(box.x, `${what} #${i}: left edge`).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width, `${what} #${i}: right edge against the window's ${view.width}`).toBeLessThanOrEqual(view.width + 1);
  });
}

async function check(page: Page, screen: Screen, size: string): Promise<void> {
  const where = `${screen.name} at ${size}`;
  if (screen.ready) await expect(screen.ready(page).first(), `${where}: the screen has loaded`).toBeVisible();
  const wide = await page.evaluate(() => window.matchMedia('(min-width: 1024px)').matches);
  if (screen.name === 'a thread') await expect(page.getByText(/^Details: /).first(), `${where}: the thread is open`).toBeVisible();
  // Polled: a resize is laid out over a frame or two, and what stays wider than the window is what he sees.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), {
      message: `${where}: the page's scrollWidth against its clientWidth`,
      timeout: 10_000,
    })
    .toBeLessThanOrEqual(0);
  await expect.poll(() => pastTheEdge(page), { message: `${where}: drawn past the window's edge`, timeout: 10_000 }).toEqual([]);
  const places = page.getByRole('navigation', { name: 'Places' });
  await expect(places, `${where}: the Places ${wide ? 'sidebar' : 'tabs'}`).toBeVisible();
  await insideWindow(page, `${where}: the Places links`, places.getByRole('link'));
  if (!wide) await expect(places.getByRole('link'), `${where}: all six tabs`).toHaveCount(6);
  if (screen.pill) await insideWindow(page, `${where}: the Live pill`, page.getByTestId('live-badge'));
  if (screen.composer) {
    const composer = page.getByTestId('composer');
    await expect(composer, `${where}: the composer`).toBeVisible();
    await insideWindow(page, `${where}: the composer`, composer);
    await insideWindow(page, `${where}: the composer's controls`, composer.locator('button, textarea, input').filter({ visible: true }));
  }
}

for (const size of [
  { width: 390, height: 844 },
  { width: 360, height: 740 },
]) {
  test(`no screen is wider than the window at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await unlock(page);
    for (const screen of SCREENS) {
      await open(page, screen.url);
      await check(page, screen, `${size.width}x${size.height}`);
    }
  });
}

test('no screen is wider than the window after a resize 1280x800 -> 390x844 -> 1280x800 with no reload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await unlock(page);
  for (const screen of SCREENS) {
    await open(page, screen.url);
    await check(page, screen, '1280x800');
    await page.setViewportSize({ width: 390, height: 844 });
    await check(page, screen, '390x844 after the resize');
    await page.setViewportSize({ width: 1280, height: 800 });
    await check(page, screen, '1280x800 after the resize back');
  }
});

test('a long unbroken link wraps inside its bubble in a channel and in a thread', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await unlock(page);
  for (const url of [screenUrl('a channel'), screenUrl('a thread')]) {
    await open(page, url);
    const link = page.getByTestId('message').filter({ hasText: 'whatsonchain.com' }).first();
    await expect(link, `${url}: a message holds the link`).toBeVisible();
    const escaped = await link.evaluate((el) => {
      const bubble = el.firstElementChild as HTMLElement;
      const b = bubble.getBoundingClientRect();
      return Array.from(bubble.querySelectorAll('*'))
        .filter((node) => {
          const r = node.getBoundingClientRect();
          return r.width > 0 && (r.right > b.right + 1 || r.left < b.left - 1);
        })
        .map((node) => `${node.tagName}: ${node.textContent?.slice(0, 40)}`);
    });
    expect(escaped, `${url}: draws outside its bubble`).toEqual([]);
    expect(await pastTheEdge(page), `${url}: drawn past the window's edge`).toEqual([]);
  }
});

test("the Roadmap's Picture follows a resize: its drawing is sized to the box it sits in, not the one it opened in", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await unlock(page);
  await open(page, '/?v=roadmap');
  await page.getByRole('tab', { name: 'Picture' }).click();
  const canvas = page.getByRole('img', { name: /The roadmap as a picture/ });
  await expect(canvas, 'the Picture drew a canvas (WebGL is on)').toBeVisible();
  for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 800 }, { width: 360, height: 740 }]) {
    await page.setViewportSize(size);
    await expect
      .poll(async () => canvas.evaluate((c: HTMLCanvasElement) => ({ box: c.clientWidth, drawn: c.width, ratio: Math.min(window.devicePixelRatio || 1, 2) })).then((r) => Math.abs(r.drawn - Math.round(r.box * r.ratio))), {
        message: `${size.width}px: the canvas's drawing is as wide as its box`,
      })
      .toBeLessThanOrEqual(1);
    const box = (await canvas.boundingBox())!;
    expect(box.x + box.width, `${size.width}px: the canvas ends inside the window`).toBeLessThanOrEqual(size.width + 1);
    expect(await pastTheEdge(page), `${size.width}px: drawn past the window's edge`).toEqual([]);
  }
});
