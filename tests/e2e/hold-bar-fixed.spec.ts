// tests/e2e/hold-bar-fixed.spec.ts — mw-j0f2d.44: while he holds to talk the bar stays where his thumb is, however long the
// live words grow. The words scroll in their own area above it (newest line in view) and the bottom bar never covers the
// bar or its round control. Read in a real browser at a phone's size and, at 360x740, at 200 % text (jsdom does no layout), in a channel's
// composer and on the Talk line, with a 20-word and then a 300-word transcript.
import { test, expect, type Page } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot, sized } from './shot';

test.use({ serviceWorkers: 'block' });

declare global {
  interface Window {
    __hear(text: string): void;
  }
}

/** A recogniser the test speaks through: `__hear` is what it heard so far (the whole hold's words, as the phone sends them). */
async function fakeRecogniser(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class Recognizer {
      static active: Recognizer | undefined;
      lang = '';
      continuous = false;
      interimResults = false;
      onaudiostart?: () => void;
      onresult?: (event: unknown) => void;
      onend?: () => void;
      onerror?: (event: unknown) => void;
      start() {
        Recognizer.active = this;
        setTimeout(() => this.onaudiostart?.(), 0);
      }
      stop() {
        setTimeout(() => this.onend?.(), 0);
      }
      abort() {}
    }
    const define = (target: object, name: string, value: unknown) => Object.defineProperty(target, name, { value, configurable: true, writable: true });
    define(window, 'SpeechRecognition', Recognizer);
    define(window, 'webkitSpeechRecognition', Recognizer);
    window.__hear = (text) => Recognizer.active?.onresult?.({ results: [[{ transcript: text }]] });
  });
}

async function unlocked(page: Page): Promise<void> {
  await fakeRecogniser(page);
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor);
  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
}

/** A 1x1 transparent PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i + 1}`).join(' ');

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
const boxOf = async (page: Page, selector: string): Promise<Box> => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  return box;
};
const meets = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Holds the bar called `rest`, feeds 20 then 300 words, and checks the bar did not move, the nav is clear of it, and the words show their newest end. */
async function holdAndFeed(page: Page, rest: string, bar: (page: Page) => string, roundControl: string | undefined, sameAsAtRest: boolean, name: string | undefined) {
  const button = page.getByRole('button', { name: rest });
  await expect(button).toBeEnabled();
  const start = (await button.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await expect(page.getByRole('button', { name: 'Release to send' })).toBeVisible();

  const nav = () => boxOf(page, '[aria-label="Places"]');
  const readings: Box[] = [];
  // at 100 % text the bar is where the thumb found it from the moment of the press
  if (sameAsAtRest) expect(await boxOf(page, bar(page)), 'the bar moved when the hold began').toEqual(start);
  for (const count of [20, 300]) {
    await page.evaluate((text) => window.__hear(text), words(count));
    await expect(page.getByTestId('live-transcript')).toContainText(`word${count}`);
    // let a layout settle: two frames
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const held = await boxOf(page, bar(page));
    readings.push(held);
    expect(meets(held, await nav()), `the bottom bar covers the bar at ${count} words`).toBe(false);
    if (roundControl) {
      const round = page.locator(roundControl);
      if (await round.count()) expect(meets((await round.first().boundingBox())!, await nav()), `the bottom bar covers the round control at ${count} words`).toBe(false);
    }
  }
  expect(readings[1], 'the bar moved when the transcript grew').toEqual(readings[0]);

  // the words scroll inside their own area, the newest line in view: the area is at its end and not taller than the window's half
  const area = await page.evaluate(() => {
    const live = document.querySelector('[data-testid="live-transcript"]') as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(live);
    const lines = [...range.getClientRects()];
    const lastBottom = Math.max(...lines.map((rect) => rect.bottom));
    const frame = live.getBoundingClientRect();
    return { lastBottom, frameBottom: frame.bottom, frameTop: frame.top, tall: live.scrollHeight > live.clientHeight, height: frame.height, window: innerHeight };
  });
  expect(area.tall, 'a 300-word transcript scrolls in its own area').toBe(true);
  expect(area.height).toBeLessThanOrEqual(area.window / 2);
  expect(area.lastBottom, 'the newest line is in view').toBeLessThanOrEqual(area.frameBottom + 1);
  expect(area.lastBottom).toBeGreaterThanOrEqual(area.frameTop);
  // nothing clips or covers the area: what is under its middle is the words
  expect(await page.evaluate(() => {
    const live = document.querySelector('[data-testid="live-transcript"]')!;
    const frame = live.getBoundingClientRect();
    const hit = document.elementFromPoint(frame.left + frame.width / 2, frame.top + frame.height / 2);
    return !!hit && live.contains(hit);
  })).toBe(true);
  expect(area.frameTop, 'the words start inside the window').toBeGreaterThanOrEqual(0);

  if (name) await shot(page, name);
  await page.mouse.up();
}

for (const zoom of [100, 200]) {
  test.describe(`${zoom === 100 ? 'a phone' : '360x740'} at ${zoom} % text`, () => {
    // 100 % text is read at every size the shots run at; 200 % at 360x740 only (a 640 px window at double text holds less than half a screen)
    test.use({ viewport: zoom === 100 ? sized({ width: 360, height: 740 }) : { width: 360, height: 740 } });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript((percent) => {
        document.addEventListener('DOMContentLoaded', () => {
          document.documentElement.style.fontSize = `${percent}%`;
        });
      }, zoom);
    });

    test(`a channel's hold bar stays put as the live words grow, and the bottom bar never covers it (mw-j0f2d.44)`, async ({ page }) => {
      await unlocked(page);
      await page.goto('/?v=talk&t=general');
      // a channel opens on its text box; the mic beside it brings the bar out
      await page.getByRole('button', { name: 'Speak a message' }).click();
      // a picture waits to go, as in his screenshot: the round Send arrow stands beside the bar
      await page.locator('input[type="file"]:not([capture])').first().setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
      await expect(page.locator('.bk-composer__bar-send')).toBeVisible();
      await holdAndFeed(page, 'Hold to talk', () => '.bk-composer__bar', '.bk-composer__bar-send', zoom === 100, zoom === 100 ? 'hold-bar-fixed-channel' : undefined);
    });

    test(`the Talk line's hold bar stays put as the live words grow, and the bottom bar never covers it (mw-j0f2d.44)`, async ({ page }) => {
      await unlocked(page);
      await page.goto('/?v=line');
      await holdAndFeed(page, 'Hold to talk', () => '.bk-composer__bar', undefined, zoom === 100, zoom === 100 ? 'hold-bar-fixed-line' : undefined);
    });
  });
}
