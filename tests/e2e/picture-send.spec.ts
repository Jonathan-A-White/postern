// tests/e2e/picture-send.spec.ts — mw-jtzpw0.10: with the Hold to talk bar out and a picture attached,
// nothing typed, a round Send arrow stands beside the bar; one tap sends the picture. The bar stays the
// big button (same height, same left edge, same bottom edge, most of its width), measured at 390x844.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });

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
  expect(tap.x + tap.width).toBeLessThanOrEqual(390);
  expect(Math.abs(tap.y + tap.height / 2 - (after.y + after.height / 2))).toBeLessThan(2);

  // one tap sends it: the message goes, the picture and the arrow are gone
  const sentBefore = posted.length;
  await arrow.click();
  await expect.poll(() => posted.length).toBeGreaterThan(sentBefore);
  await expect(page.getByRole('button', { name: 'View photo.png' })).toBeHidden();
  await expect(arrow).toBeHidden();
});
