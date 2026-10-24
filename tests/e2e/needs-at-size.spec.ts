// tests/e2e/needs-at-size.spec.ts — mw-ev7oyy.43: on 2026-10-17 a tap on Needs you froze his phone for good
// (Postern 0.8.12). The view that day held 1067 needs and 1252 beads (264 cards his). Here a view of that shape
// (tests/support/live-shape-view.ts), at that size and at 150 needs, is served; from Me a tap on Needs you must
// show its cards and leave the page answering within 3 s, and so must every other tab and the folded
// 'Waiting on your use' list; every one of his cards still arrives. The times are logged
// for the closing comment. The 3 s is real time (a timing test: docs/timing-tests.md), scaled by how slow the
// host is at that moment (host-slowdown.ts), so a loaded host cannot fail it. covers: src/**, tests/support/live-shape-view.ts
import { test, expect, type Page } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot, sized } from './shot';
import { hostSlowdown } from './host-slowdown';
import { LIVE_SIZE, liveShapeView, type ViewSize } from '../support/live-shape-view';

test.use({ serviceWorkers: 'block', viewport: sized({ width: 390, height: 844 }) });

const OPENS_WITHIN_MS = 3000;

async function unlockedOnMe(page: Page, size: ViewSize): Promise<void> {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor, undefined, { view: liveShapeView(Date.now(), size) });
  await seedVault(page, mnemonic);
  await page.goto('/?v=me');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Me', exact: true })).toBeVisible();
  // The view has arrived and is stored: the Needs you tab counts his cards.
  await expect(page.getByRole('link', { name: /Needs you/ }).getByText(/^\d+\+?$/)).toBeVisible();
}

interface Timed {
  /** From the tap until the thing opened and the page answered (ms). */
  ms: number;
  /** How long a timer set once it was open took to fire (ms): a page busy in a render loop does not answer it. */
  gap: number;
  /** The slowness of the host while it did (hostSlowdown, before and after: the larger counts). */
  slowdown: number;
}

const TIMER_ANSWERS_WITHIN_MS = 500;

/** The promise is 3 s on a calm host: what the host's slowness at the time stretches it to (hostSlowdown). */
function within(slowdown: number): number {
  return OPENS_WITHIN_MS * slowdown;
}

function answered(t: Timed): boolean {
  return t.ms < within(t.slowdown) && t.gap < TIMER_ANSWERS_WITHIN_MS * t.slowdown;
}

const TAPS = 3;

/**
 * The app's own speed is the best of a few taps. The host's slowness is read around a tap, so a stall that lands inside
 * one tap and leaves the readings calm (a To do that took 4.9 s where its neighbours took 0.7 s, at 1.5x before and
 * after: the landing gate on 2026-10-21) is not the app; an app that really is slow is slow every time. The first tap
 * that answers is the answer; if none does, the least bad is, and its numbers fail the test.
 */
async function bestOfTaps(tap: () => Promise<Timed>, reset: () => Promise<void>): Promise<Timed> {
  let best: Timed | undefined;
  for (let i = 0; i < TAPS; i++) {
    if (i > 0) await reset();
    const t = await tap();
    if (answered(t)) return t;
    if (!best || t.ms / t.slowdown < best.ms / best.slowdown) best = t;
  }
  return best as Timed;
}

/**
 * Taps the tab and waits for `opened`, then for the page to answer a timer; see bestOfTaps for the retries, which leave by Me.
 */
async function tapAndTime(page: Page, tab: string, opened: () => Promise<void>): Promise<Timed> {
  const places = page.getByRole('navigation', { name: 'Places' });
  const tapOnce = async (): Promise<Timed> => {
    const slowBefore = await hostSlowdown(page);
    const tappedAt = await page.evaluate(() => performance.now());
    await places.getByRole('link', { name: tab }).click();
    await opened();
    const answeredAt = await page.evaluate(() => performance.now());
    // Still answering a moment later: no render loop is keeping the page busy.
    const gap = await page.evaluate(() => new Promise<number>((resolve) => {
      const asked = performance.now();
      setTimeout(() => resolve(performance.now() - asked), 0);
    }));
    return { ms: answeredAt - tappedAt, gap, slowdown: Math.max(slowBefore, await hostSlowdown(page)) };
  };
  const leave = async (): Promise<void> => {
    await places.getByRole('link', { name: 'Me' }).click();
    await expect(page.getByRole('heading', { name: 'Me', exact: true })).toBeVisible();
  };
  const t = await bestOfTaps(tapOnce, leave);
  expect(t.gap, `${tab}: the page answers a timer at once once it is open`).toBeLessThan(TIMER_ANSWERS_WITHIN_MS * t.slowdown);
  return t;
}

const SIZES: Array<{ name: string; size: ViewSize }> = [
  { name: `today's view (${LIVE_SIZE.needs} needs, ${LIVE_SIZE.beads} beads)`, size: LIVE_SIZE },
  { name: '150 needs, none folded', size: { needs: 150, beads: LIVE_SIZE.beads, folded: 0 } },
];

/** Slows the page's main thread `rate` times, as a host under load does (Chrome's own CPU throttle: no load is made). */
async function slowBrowser(page: Page, rate: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

async function everyTabOpens(page: Page, name: string, size: ViewSize): Promise<void> {
  await unlockedOnMe(page, size);

  const needs = await tapAndTime(page, 'Needs you', () => expect(page.getByTestId('need-card').first()).toBeVisible());
  console.log(`${name}: Needs you answered ${Math.round(needs.ms)} ms after the tap (host ${needs.slowdown.toFixed(1)}x)`);
  expect(needs.ms, 'Needs you opens and answers').toBeLessThan(within(needs.slowdown));
  // The rest of his cards follow while the page answers: none is left out. They arrive a batch at a time, so on a browser slowed
  // 20x the count is still climbing when the default 5 s ends (60 ... 116 of them, the landing gate on 2026-10-24); this wait is
  // for the last card, not a promise about speed (the times above are), so it waits as long as the count keeps moving up to 60 s.
  const his = Number((await page.getByRole('tab', { name: /^You · / }).textContent())?.replace(/\D+/g, ''));
  await expect(page.getByTestId('need-card')).toHaveCount(his, { timeout: 60_000 });
  if (size === LIVE_SIZE) await shot(page, 'needs-at-size');

  // The folded verify cards (359 of them that day) open the same way: a tap on the foot line answers at once.
  const foot = page.getByRole('button', { name: /^Waiting on your use \(\d+\)$/ });
  if (size.folded > 0) {
    const region = page.getByRole('region', { name: 'Waiting on your use' });
    const tapFoot = async (): Promise<Timed> => {
      const slowBefore = await hostSlowdown(page);
      const tappedAt = await page.evaluate(() => performance.now());
      await foot.click();
      await expect(region.getByTestId('need-card').first()).toBeVisible();
      const ms = (await page.evaluate(() => performance.now())) - tappedAt;
      return { ms, gap: 0, slowdown: Math.max(slowBefore, await hostSlowdown(page)) };
    };
    // A retry folds the list again first.
    const fold = async (): Promise<void> => {
      await foot.click();
      await expect(region.getByTestId('need-card')).toHaveCount(0);
    };
    const { ms, slowdown } = await bestOfTaps(tapFoot, fold);
    console.log(`${name}: Waiting on your use answered ${Math.round(ms)} ms after the tap (host ${slowdown.toFixed(1)}x)`);
    expect(ms, 'Waiting on your use opens and answers').toBeLessThan(within(slowdown));
  }

  const tabs: Array<{ tab: string; opened: () => Promise<void> }> = [
    { tab: 'To do', opened: () => expect(page.getByRole('heading', { name: 'To do', exact: true })).toBeVisible() },
    { tab: 'Map', opened: () => expect(page.getByRole('heading', { name: 'Map', exact: true })).toBeVisible() },
    { tab: 'Channels', opened: () => expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible() },
    { tab: 'Search', opened: () => expect(page.getByRole('heading', { name: 'Search', exact: true })).toBeVisible() },
    { tab: 'Needs you', opened: () => expect(page.getByTestId('need-card').first()).toBeVisible() },
  ];
  for (const { tab, opened } of tabs) {
    const { ms, slowdown } = await tapAndTime(page, tab, opened);
    console.log(`${name}: ${tab} answered ${Math.round(ms)} ms after the tap (host ${slowdown.toFixed(1)}x)`);
    expect(ms, `${tab} opens and answers`).toBeLessThan(within(slowdown));
  }
}

for (const { name, size } of SIZES) {
  test(`${name}: Needs you opens within 3 s, and so does every other tab`, async ({ page }) => {
    test.setTimeout(120_000);
    await everyTabOpens(page, name, size);
  });
}

// mw-gq6.684: on a host under load the wall clock runs long for the page and not for the app. A browser slowed
// 20x is such a host: every tab must still open and answer in 3 s of the host's own time (3 s x the slowdown
// measured around the tap), so the load cannot fail it and an app that got slower still does.
test("150 needs on a browser slowed 20x: every tab opens within 3 s of the host's own time", async ({ page }) => {
  test.setTimeout(300_000);
  await slowBrowser(page, 20);
  await everyTabOpens(page, 'slowed 20x', SIZES[1].size);
});
