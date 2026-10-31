// tests/e2e/keyboard-composer.spec.ts — mw-ojmy9q3: with a picture attached and the keyboard open, he must see what he
// types. On Android Chrome the viewport meta says interactive-widget=resizes-content, so an open keyboard shrinks the
// window the page lays out in (the layout viewport and the visual viewport are the same, ~43 % shorter). Desktop
// Chromium has no keyboard, so it is made the way the browser makes it: the window is resized. With the tab bar, the
// header, the Emergency banner and a thumbnail row all asking for room, the composer's text field was pushed under the
// tab bar: his draft sat cut off at the foot of the screen.
//
// Checked by bounding box at 360x640 and 390x844, in a channel, a thread's reply, a bead's conversation: the text
// field (and so its last typed line, three lines tall and not scrolled), the thumbnail with its Remove, and the Send
// control lie wholly inside the window, above the keyboard, and the tab bar does not cover them. Each with the
// Emergency banner up, and in the channel also without it and without the picture.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { LONG_LINK_ROOT_TXID } from '../support/cockpit-fixture';

test.use({ serviceWorkers: 'block' });

// a 2×2 red PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z8Dwn4GBgYEBAB8CAgFsrJ/LAAAAAElFTkSuQmCC', 'base64');

const SIZES = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
];
/** How much of the screen the keyboard covers in his screenshot (about 43 %). */
const KEYBOARD = 0.43;

const PLACES = [
  { name: 'a channel', url: '/?v=talk&t=general', placeholder: 'Message the Mayor…' },
  { name: 'a thread reply', url: `/?v=talk&t=general&r=${encodeURIComponent(LONG_LINK_ROOT_TXID)}`, placeholder: 'Reply…' },
  { name: 'a bead channel', url: '/?v=bead&id=mw-f758y.30.2', placeholder: 'Say something about mw-f758y.30.2…' },
];

async function unlock(page: Page): Promise<void> {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor, undefined, { longLink: true });
  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('need-card').first()).toBeVisible();
}

/** An emergency (§22) the phone holds and he has not tapped away: written into the events store, then the page reloads to read it. */
async function holdEmergency(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('PosternDB');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['events'], 'readwrite');
          tx.objectStore('events').put({
            seq: 9_000,
            ts: new Date().toISOString(),
            kind: 'job',
            bead: '',
            actor: 'doctor@desktop',
            from: 'running',
            to: 'failed',
            detail: 'The build on the laptop failed twice in a row.',
            lane: 'emergency',
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox();
  if (!found) throw new Error('no box');
  return found;
}

/** Whether `inner` lies wholly inside the first `height` px of the window, above `limit` (the top of whatever must not cover it). */
function expectAbove(name: string, inner: Box, limit: number, view: { width: number; height: number }): void {
  expect(inner.y, `${name}: top is inside the window`).toBeGreaterThanOrEqual(0);
  expect(inner.x, `${name}: left is inside the window`).toBeGreaterThanOrEqual(0);
  expect(inner.x + inner.width, `${name}: right is inside the window`).toBeLessThanOrEqual(view.width);
  expect(inner.y + inner.height, `${name}: foot is above the tab bar and the keyboard (${limit})`).toBeLessThanOrEqual(Math.min(limit, view.height) + 0.5);
}

for (const size of SIZES) {
  const keyboardOpen = { width: size.width, height: Math.round(size.height * (1 - KEYBOARD)) };
  for (const place of PLACES) {
    // His case (a picture and the banner) in every composer; the channel also without the banner and without the picture
    const variants = place.name === 'a channel' ? [[true, true], [true, false], [false, true]] : [[true, true]];
    for (const [banner, picture] of variants) {
      const title = `${place.name} at ${size.width}x${size.height}, keyboard open, ${picture ? 'a picture attached' : 'no picture'}, ${banner ? 'Emergency banner up' : 'no banner'}: the text field, its last typed line and the thumbnail are in view above the tab bar`;
      test(title, async ({ page }) => {
        await page.setViewportSize(size);
        await unlock(page);
        if (banner) {
          await holdEmergency(page);
          await page.reload();
          await expect(page.getByRole('alert', { name: 'Emergency' })).toBeVisible();
        }
        await page.goto(place.url);
        const field = page.getByPlaceholder(place.placeholder);
        await expect(field).toBeVisible();
        // the keyboard opens: the window the page lays out in is 43 % shorter
        await page.setViewportSize(keyboardOpen);
        if (picture) {
          await page.locator('input[type="file"][multiple]').first().setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
          await expect(page.getByRole('button', { name: 'View photo.png' })).toBeVisible();
        }
        await field.focus();
        await field.fill('Any verse like this\nshould be one\nline per thought');

        // the tab bar stands aside while he types in a window this short, or it stays below everything he sees
        const tabBar = page.getByRole('navigation', { name: 'Places' });
        const tabs = (await tabBar.isVisible()) ? await box(tabBar) : { x: 0, y: keyboardOpen.height, width: size.width, height: 0 };
        const seen = await page.evaluate(() => ({ width: window.visualViewport?.width ?? innerWidth, height: window.visualViewport?.height ?? innerHeight }));
        expect(seen.height, 'the window is the keyboard-open height').toBeLessThanOrEqual(keyboardOpen.height);

        // the text field, and in it all three typed lines (not scrolled, not clipped: the field's own borders are the 4 px)
        const inner = await field.evaluate((el) => ({ clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, scrollTop: (el as HTMLTextAreaElement).scrollTop }));
        expect(inner.scrollHeight, 'all three lines fit in the text field').toBeLessThanOrEqual(inner.clientHeight + 4);
        expect(inner.scrollTop).toBeLessThanOrEqual(4);
        const fieldBox = await box(field);
        expect(fieldBox.height, 'the field is three lines tall').toBeGreaterThanOrEqual(3 * 16);
        expectAbove('the text field', fieldBox, tabs.y, seen);
        // the picture's thumbnail with its X
        if (picture) {
          expectAbove('the thumbnail', await box(page.getByRole('button', { name: 'View photo.png' })), tabs.y, seen);
          expectAbove('the thumbnail Remove', await box(page.getByRole('button', { name: 'Remove photo.png' })), tabs.y, seen);
        }
        // the control that sends what he typed
        expectAbove('Send', await box(page.getByRole('button', { name: 'Send', exact: true })), tabs.y, seen);
        // the tab bar itself is still in the window (nothing is pushed off the foot)
        expect(tabs.y + tabs.height).toBeLessThanOrEqual(seen.height + 0.5);
        // and the header still shows: nothing is pushed off the top
        expect((await box(page.getByRole('heading', { level: 1 }))).y).toBeGreaterThanOrEqual(0);
      });
    }
  }
}

// The Talk line's composer has no text field (a hold bar, Attach and Take a photo, the chosen files as chips and Send), so no keyboard
// ever opens on it; it must still show its chosen picture, its bar and its Send above the tab bar at a small phone's own height.
for (const size of SIZES) {
  test(`the Talk line at ${size.width}x${size.height}, a picture chosen: its chip, the hold bar and Send are in view above the tab bar`, async ({ page }) => {
    await page.setViewportSize(size);
    await unlock(page);
    await page.goto('/?v=line');
    await expect(page.getByRole('button', { name: 'Attach', exact: true })).toBeVisible();
    await page.locator('input[type="file"][multiple]:not([capture])').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId('talk-attached')).toBeVisible();
    const tabs = await box(page.getByRole('navigation', { name: 'Places' }));
    const seen = { width: size.width, height: size.height };
    expectAbove('the chosen picture', await box(page.getByTestId('talk-attached')), tabs.y, seen);
    expectAbove('Send', await box(page.getByRole('button', { name: 'Send', exact: true })), tabs.y, seen);
    expectAbove('the hold bar', await box(page.getByRole('button', { name: /^Hold/ }).first()), tabs.y, seen);
  });
}
