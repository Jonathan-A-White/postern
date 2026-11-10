// tests/e2e/picture-send.spec.ts — mw-jtzpw0.10: with the Hold to talk bar out and a picture attached,
// nothing typed, a round Send arrow stands beside the bar; one tap sends the picture. The bar stays the
// big button (same height, same left edge, same bottom edge, most of its width), measured at 390x844.
import { test, expect, type Page } from '@playwright/test';
import { randomFillSync } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot, sized } from './shot';
import { LONG_LINK_ROOT_TXID } from '../support/cockpit-fixture';
import { hostSlowdown } from './host-slowdown';

// the width the shots run is at (390 unless `npm run shots` is on another size): nothing may be wider than it
const PHONE_WIDTH = sized({ width: 390, height: 844 }).width;
test.use({ serviceWorkers: 'block', viewport: sized({ width: 390, height: 844 }) });

// a 2×2 red PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z8Dwn4GBgYEBAB8CAgFsrJ/LAAAAAElFTkSuQmCC', 'base64');

test('a picture with nothing typed sends with one tap on the arrow beside Hold to talk', async ({ page }) => {
  // the bar needs a speech recogniser to be offered; this one only opens its mic
  await page.addInitScript(() => {
    class Recognizer {
      lang = '';
      continuous = false;
      interimResults = false;
      onaudiostart?: () => void;
      onend?: () => void;
      start() {
        setTimeout(() => this.onaudiostart?.(), 0);
      }
      stop() {
        setTimeout(() => this.onend?.(), 0);
      }
      abort() {}
    }
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: Recognizer, configurable: true, writable: true });
  });
  const mnemonic = createMnemonic();
  const governorKeyBytes = await deriveMasterKey(mnemonic);
  const governor = PrivateKey.fromHex(Buffer.from(governorKeyBytes).toString('hex'));
  const { posted } = await stubBackend(page, governor);
  await page.route('**/api/blobs', (route) => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ hash: 'ab'.repeat(32), size: 120 }) }));
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('need-card').first()).toBeVisible();

  await page.goto('/?v=talk&t=general');
  await page.getByRole('button', { name: 'Speak a message' }).click();
  const bar = page.getByRole('button', { name: 'Hold to talk' });
  await expect(bar).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeHidden();
  const before = await bar.boundingBox();

  await page.locator('input[type="file"][multiple]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('button', { name: 'View photo.png' })).toBeVisible();
  const arrow = page.getByRole('button', { name: 'Send', exact: true });
  await expect(arrow).toBeVisible();
  await shot(page, 'picture-send');

  // Hold to talk stays the big button: same height, left edge and bottom edge, most of its width; the arrow is after it
  const after = await bar.boundingBox();
  const tap = await arrow.boundingBox();
  if (!before || !after || !tap) throw new Error('no boxes');
  expect(after.height).toBe(before.height);
  expect(after.x).toBe(before.x);
  expect(after.y + after.height).toBe(before.y + before.height);
  expect(after.width).toBeGreaterThan(before.width * 0.75);
  expect(tap.x).toBeGreaterThanOrEqual(after.x + after.width);
  expect(tap.width).toBeGreaterThanOrEqual(44);
  expect(tap.height).toBeGreaterThanOrEqual(44);
  expect(tap.x + tap.width).toBeLessThanOrEqual(PHONE_WIDTH);
  expect(Math.abs(tap.y + tap.height / 2 - (after.y + after.height / 2))).toBeLessThan(2);

  // one tap sends it: the message goes, the picture and the arrow are gone
  const sentBefore = posted.length;
  await arrow.click();
  await expect.poll(() => posted.length).toBeGreaterThan(sentBefore);
  await expect(page.getByRole('button', { name: 'View photo.png' })).toBeHidden();
  await expect(arrow).toBeHidden();
});

// mw-6j8xmr: every compose bar of the app takes several pictures and files and sends them as one message
// (the Talk line's own screen is in talk-line.spec.ts).
const ATTACH_POINTS = [
  { name: 'a channel', url: '/?v=talk&t=general' },
  { name: 'a thread reply', url: `/?v=talk&t=general&r=${encodeURIComponent(LONG_LINK_ROOT_TXID)}` },
  { name: "a bead page's channel", url: '/?v=bead&id=mw-f758y.30.2' },
];

for (const point of ATTACH_POINTS) {
  test(`${point.name} takes 3 pictures and 2 files and sends them as one message (mw-6j8xmr)`, async ({ page }) => {
    const mnemonic = createMnemonic();
    const governorKeyBytes = await deriveMasterKey(mnemonic);
    const governor = PrivateKey.fromHex(Buffer.from(governorKeyBytes).toString('hex'));
    const { posted } = await stubBackend(page, governor, undefined, { longLink: true });
    let uploads = 0;
    await page.route('**/api/blobs', (route) => {
      uploads += 1;
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ hash: String(uploads).padStart(2, 'a').repeat(32), size: 120 }) });
    });
    await seedVault(page, mnemonic);
    await page.goto('/');
    await page.getByLabel('Recovery phrase').fill(mnemonic);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByTestId('need-card').first()).toBeVisible();

    await page.goto(point.url);
    const picture = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG });
    const file = (name: string, mimeType: string) => ({ name, mimeType, buffer: Buffer.from('some words') });
    await page.locator('input[type="file"][multiple]').first().setInputFiles([picture('one.png'), picture('two.png'), picture('three.png'), file('notes.pdf', 'application/pdf'), file('log.txt', 'text/plain')]);
    for (const name of ['one.png', 'two.png', 'three.png']) await expect(page.getByRole('button', { name: `View ${name}` })).toBeVisible();
    await expect(page.getByText('notes.pdf')).toBeVisible();
    await expect(page.getByText('log.txt')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE_WIDTH);

    const before = posted.length;
    await page.getByRole('textbox', { name: /Message|Reply|Say something/ }).first().fill('five files');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => posted.length).toBe(before + 1);
    expect(uploads).toBe(5);
  });
}

// mw-8xe671n: sending felt sluggish, worse with a photo. A text and a 2 MB photo are sent in a channel on a phone-sized
// screen, the browser slowed 4x as a phone's CPU is (Chrome's own throttle), and each send is timed from the tap: when the
// composer is free again, when the message shows in the thread, and each stage between (the app's postern:send:* marks).
// The composer is free within 300 ms of the tap and the message shows within 1 s (both scaled by how loaded the host
// is), whatever is sent, and the page is never frozen for a second while a photo goes.

/** A phone screenshot, 1080x2400, as a PNG of about 2 MB: dark with bands of noise (noise does not compress). */
function screenshotPng(): Buffer {
  const width = 1080;
  const height = 2400;
  // each row: filter byte 0, then RGB
  const rows = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const start = y * (1 + width * 3) + 1;
    const row = rows.subarray(start, start + width * 3);
    if (y % 40 < 11) randomFillSync(row);
    else for (let x = 0; x < row.length; x += 3) row.set([20, 40, 90], x);
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** How much slower a phone's main thread is than this browser's (Chrome DevTools' 'mid-tier mobile'). */
const PHONE_CPU = 4;
/** The composer is free again within this of the tap (ms, on a calm host). */
const FREE_WITHIN_MS = 300;
/** The message shows in its thread, pending, within this of the tap (ms, on a calm host): a 2 MB photo took 3 s. */
const SHOWN_WITHIN_MS = 1000;
/** The page's main thread is never busy longer than this at a stretch while a photo goes (ms): its sealing held it 4 s. */
const BUSY_AT_MOST_MS = 1000;

interface SendTimes {
  /** From the tap: the composer free (box empty, nothing attached, Send not busy), and the message's bubble in the thread. */
  free: number;
  shown: number;
  /** The longest the main thread was busy at a stretch since the tap (ms). */
  longest: number;
  /** The app's own marks, ms after its tap mark. */
  marks: Record<string, number>;
}

/** Watches the page from the tap on Send: when the composer is free and when a bubble saying `words` is in the thread. */
async function watchSend(page: Page, words: string): Promise<void> {
  await page.evaluate((text) => {
    performance.clearMarks();
    const times: { tap?: number; free?: number; shown?: number; longest: number } = { longest: 0 };
    // the longest the page's main thread was busy at a stretch from the tap on (a frozen page answers no tap)
    new PerformanceObserver((list) => {
      for (const task of list.getEntries()) if (times.tap !== undefined && task.startTime + task.duration > times.tap) times.longest = Math.max(times.longest, task.duration);
    }).observe({ type: 'longtask' });
    (window as unknown as { sendTimes: typeof times }).sendTimes = times;
    const composerFree = () => {
      const composer = document.querySelector('[data-testid="composer"]');
      if (!composer) return false;
      const box = composer.querySelector('textarea');
      return (!box || box.value === '') && !composer.querySelector('[aria-label^="View "]');
    };
    const bubbleShown = () => [...document.querySelectorAll('[data-testid="message"]')].some((bubble) => bubble.textContent?.includes(text));
    const look = () => {
      if (times.tap === undefined) return;
      const now = performance.now();
      if (times.free === undefined && composerFree()) times.free = now;
      if (times.shown === undefined && bubbleShown()) times.shown = now;
    };
    document.addEventListener('pointerdown', () => (times.tap ??= performance.now()), { capture: true, once: true });
    new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    const frame = () => {
      look();
      if (times.free === undefined || times.shown === undefined) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, words);
}

async function sendTimes(page: Page): Promise<SendTimes> {
  await expect.poll(() => page.evaluate(() => {
    const times = (window as unknown as { sendTimes: { free?: number; shown?: number } }).sendTimes;
    return times.free !== undefined && times.shown !== undefined;
  })).toBe(true);
  return page.evaluate(() => {
    const times = (window as unknown as { sendTimes: { tap: number; free: number; shown: number; longest: number } }).sendTimes;
    const marks = performance.getEntriesByType('mark').filter((mark) => mark.name.startsWith('postern:send:'));
    const tap = marks.find((mark) => mark.name === 'postern:send:tap')?.startTime ?? times.tap;
    return {
      free: times.free - times.tap,
      shown: times.shown - times.tap,
      longest: times.longest,
      marks: Object.fromEntries(marks.map((mark) => [mark.name.replace('postern:send:', ''), Math.round(mark.startTime - tap)])),
    };
  });
}

test('a text and a 2 MB photo each show in the thread at once and leave the composer free within 300 ms (mw-8xe671n)', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  const { posted } = await stubBackend(page, governor);
  await page.route('**/api/blobs', (route) => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ hash: 'cd'.repeat(32), size: 2_000_000 }) }));
  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('need-card').first()).toBeVisible();
  await page.goto('/?v=talk&t=general');
  const box = page.getByRole('textbox', { name: /Message|Reply|Say something/ }).first();
  await expect(box).toBeVisible();

  const hostBefore = await hostSlowdown(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: PHONE_CPU });
  const send = page.getByRole('button', { name: 'Send', exact: true });

  // a text
  await box.fill('A quick word to the Mayor');
  await watchSend(page, 'A quick word to the Mayor');
  const before = posted.length;
  await send.click();
  const text = await sendTimes(page);
  await expect.poll(() => posted.length).toBe(before + 1);
  console.log(`mw-8xe671n text (host ${hostBefore.toFixed(1)}x before, cpu ${PHONE_CPU}x): free ${Math.round(text.free)} ms, shown ${Math.round(text.shown)} ms, longest task ${Math.round(text.longest)} ms, marks ${JSON.stringify(text.marks)}`);

  // a 2 MB photo, with a caption to find its bubble by
  const photo = screenshotPng();
  expect(photo.length).toBeGreaterThan(1_900_000);
  await page.locator('input[type="file"][multiple]').first().setInputFiles({ name: 'terminal.png', mimeType: 'image/png', buffer: photo });
  await expect(page.getByRole('button', { name: 'View terminal.png' })).toBeVisible();
  await box.fill('The terminal now');
  await watchSend(page, 'The terminal now');
  await send.click();
  const picture = await sendTimes(page);
  await expect.poll(() => posted.length, { timeout: 60_000 }).toBe(before + 2);
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName('postern:send:answered').length)).toBeGreaterThan(0);
  const done = await sendTimes(page);
  console.log(`mw-8xe671n photo ${photo.length} B (host ${hostBefore.toFixed(1)}x before, cpu ${PHONE_CPU}x): free ${Math.round(picture.free)} ms, shown ${Math.round(picture.shown)} ms, longest task ${Math.round(done.longest)} ms, marks ${JSON.stringify(done.marks)}`);

  // mw-qtu3zvz.49.23: the host is read again now, with the phone's slowing lifted for the spins, and the larger of the two readings
  // scales the promise. One reading before the sends went stale: the sends take 15 to 25 s on a loaded host, and a 5x reading
  // taken while the other workers were still starting held a photo that then met 10x to 13x to a 5x promise (shown 6319 ms of 5047).
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const hostAfter = await hostSlowdown(page);
  const host = Math.max(hostBefore, hostAfter);
  const [freeWithin, shownWithin, busyAtMost] = [FREE_WITHIN_MS * host, SHOWN_WITHIN_MS * host, BUSY_AT_MOST_MS * host];
  console.log(`mw-8xe671n host ${hostBefore.toFixed(1)}x before the sends, ${hostAfter.toFixed(1)}x after: the promise is scaled by ${host.toFixed(1)}x`);

  expect(text.free, 'the composer is free after a text').toBeLessThan(freeWithin);
  expect(picture.free, 'the composer is free after a photo').toBeLessThan(freeWithin);
  expect(text.shown, 'a text shows in its thread at once').toBeLessThan(shownWithin);
  expect(picture.shown, 'a photo shows in its thread at once').toBeLessThan(shownWithin);
  expect(done.longest, 'the page answers taps while the photo goes').toBeLessThan(busyAtMost);
});
