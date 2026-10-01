// tests/e2e/talk-line.spec.ts — mw-j0f2d.8: the Talk line in a real browser with the
// phone's speech recogniser, speech synthesis, vibration and wake lock faked: hold to
// talk, a buzz on hold and release, the Mayor's answer shown and spoken, a tap that
// cuts it, and a long press on the Channels tab that opens the line.
import { test, expect, type Page } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { encryptMessage } from '../../src/services/messages';
import { encodeTurn } from '../../src/services/talk';
import { MAYOR } from '../support/cockpit-fixture';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';

test.use({ serviceWorkers: 'block' });

declare global {
  interface Window {
    __hear(text: string): void;
    __spoken: string[];
    __cancels: number;
    __vibrations: number[];
    __locks: { requested: number; released: number };
  }
}

/** The faked browser speech, vibration and wake lock; `__hear` is what the recogniser hears. */
async function fakeSpeech(page: Page): Promise<void> {
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
        // a real recogniser says when the mic is open; the screen waits for it
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
    window.__spoken = [];
    window.__cancels = 0;
    define(window, 'speechSynthesis', {
      speak: (utterance: { text: string }) => window.__spoken.push(utterance.text),
      cancel: () => (window.__cancels += 1),
      getVoices: () => [],
    });
    window.__vibrations = [];
    define(navigator, 'vibrate', (ms: number) => window.__vibrations.push(ms) > 0);
    window.__locks = { requested: 0, released: 0 };
    define(navigator, 'wakeLock', {
      request: async () => {
        window.__locks.requested += 1;
        return { release: async () => void (window.__locks.released += 1) };
      },
    });
    define(crypto, 'randomUUID', () => 'talk-e2e');
  });
}

async function unlocked(page: Page): Promise<{ posted: string[]; answerAfterTurn: (text: string) => void }> {
  await fakeSpeech(page);
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  const { posted } = await stubBackend(page, governor);

  // The Mayor's answer to turn 1 shows up in the record list once his turn has been posted.
  let answer: string | undefined;
  const record = () => ({
    seq: 1000,
    txid: `direct:${'d'.repeat(64)}`,
    vout: 0,
    payload: {
      ...encryptMessage({
        text: encodeTurn({ talk: { id: 'talk-e2e', turn: 1 }, text: answer ?? '', role: 'answer', model: 'sonnet' }),
        class: 'talk',
        senderPrivateKeyHex: MAYOR.toHex(),
        recipientPublicKeyHex: governor.toPublicKey().toString(),
      }),
      ts: Math.floor(Date.now() / 1000),
    },
  });
  await page.route('**/api/messages**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const since = Number(new URL(route.request().url()).searchParams.get('since') ?? 0);
    const records = answer && posted.length > 0 && since < 1000 ? [record()] : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records, next: records.length ? 1000 : since }) });
  });

  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  return {
    posted,
    answerAfterTurn: (text) => {
      answer = text;
    },
  };
}

test('talk line: hold to talk, a spoken answer with its timing, and a tap that cuts it', async ({ page }) => {
  const { posted, answerAfterTurn } = await unlocked(page);
  answerAfterTurn('Three things landed.');

  await page.goto('/?v=line');
  const button = page.getByRole('button', { name: 'Hold to talk' });
  await expect(button).toBeEnabled();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByRole('button', { name: 'Release to send' })).toBeVisible();
  await page.evaluate(() => window.__hear('What landed today?'));
  await expect(page.getByTestId('live-transcript')).toHaveText('What landed today?');
  expect(await page.evaluate(() => window.__vibrations.length)).toBe(1);
  await shot(page, 'talk-line-listening');
  await page.mouse.up();
  expect(await page.evaluate(() => window.__vibrations.length)).toBe(2);

  await expect.poll(() => posted.length).toBe(1);
  await expect(page.getByTestId('talk-said')).toHaveText('What landed today?');
  await expect.poll(() => page.evaluate(() => window.__locks.requested)).toBeGreaterThan(0);

  const answered = page.getByTestId('talk-answer');
  await expect(answered).toContainText('Three things landed.', { timeout: 15_000 });
  await expect(answered).toContainText(/first words in \d+\.\d s/);
  expect(await page.evaluate(() => window.__spoken)).toEqual(['Three things landed.']);
  await shot(page, 'talk-line-answer');

  const cancelsBefore = await page.evaluate(() => window.__cancels);
  await page.getByRole('button', { name: 'Cut the answer' }).click();
  await expect(page.getByRole('button', { name: 'Cut the answer' })).toHaveCount(0);
  expect(await page.evaluate(() => window.__cancels)).toBeGreaterThan(cancelsBefore);

  await page.getByRole('button', { name: 'End talk' }).click();
  await expect.poll(() => page.evaluate(() => window.__locks.released)).toBeGreaterThan(0);
  await expect.poll(() => posted.length).toBe(2);
});

test('the Channels tab: a short tap lists the channels, a long press opens the Talk line', async ({ page }) => {
  await unlocked(page);
  const tab = page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: /Channels$/ });

  await tab.click();
  await expect(page).toHaveURL(/\?v=talk$/);
  await expect(page.getByRole('heading', { name: 'Channels' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Talk to the Mayor' })).toBeVisible();
  expect(await page.evaluate(() => window.__vibrations.length)).toBe(0);

  await page.goto('/?v=needs');
  const box = (await tab.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page).toHaveURL(/\?v=line$/);
  await expect(page.getByRole('button', { name: 'Hold to talk' })).toBeVisible();
  expect(await page.evaluate(() => window.__vibrations.length)).toBe(1);

  await page.goto('/?v=talk');
  await page.getByRole('button', { name: 'Talk to the Mayor' }).click();
  await expect(page).toHaveURL(/\?v=line$/);
  await shot(page, 'talk-line-idle');
});
