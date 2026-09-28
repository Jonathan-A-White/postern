// tests/e2e/voice-player.spec.ts — mw-f758y.26: a voice note in a bead's thread
// plays, shows Pause while it does (screenshot), and tapping Pause stops it.
// The note is a real, decrypted audio blob (a generated tone) served by the stub.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';

test.use({ serviceWorkers: 'block' });

/** A 30 s, 8 kHz, 8-bit mono WAV of a quiet tone. */
function toneWav(seconds: number): Uint8Array {
  const rate = 8000;
  const samples = rate * seconds;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => bytes.set([c.charCodeAt(0)], offset + i));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) bytes[44 + i] = 128 + Math.round(20 * Math.sin((2 * Math.PI * 440 * i) / rate));
  return bytes;
}

test('a voice note can be paused once it is playing', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor, { bytes: toneWav(30), mime: 'audio/wav' });
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();

  await page.goto('/?v=bead&id=mw-f758y.30.2');
  const play = page.getByRole('button', { name: 'Play voice note' });
  await expect(play).toBeVisible();
  await play.click();

  const pause = page.getByRole('button', { name: 'Pause voice note' });
  await expect(pause).toBeVisible();
  await expect.poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime)).toBeGreaterThan(0.2);
  await page.getByTestId('voice-player').scrollIntoViewIfNeeded();
  await shot(page, 'voice-player-playing');

  await pause.click();
  await expect(page.getByRole('button', { name: 'Play voice note' })).toBeVisible();
  expect(await page.locator('audio').evaluate((el: HTMLAudioElement) => el.paused)).toBe(true);
});
