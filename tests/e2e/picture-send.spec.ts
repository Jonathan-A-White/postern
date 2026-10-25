// tests/e2e/picture-send.spec.ts — mw-jtzpw0.10: with the Hold to talk bar out and a picture attached,
// nothing typed, a round Send arrow stands beside the bar; one tap sends the picture. The bar stays the
// big button (same height, same left edge, same bottom edge, most of its width), measured at 390x844.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot, sized } from './shot';
import { LONG_LINK_ROOT_TXID } from '../support/cockpit-fixture';

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
