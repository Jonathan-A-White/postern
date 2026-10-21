// tests/e2e/talk-line.spec.ts — mw-j0f2d.8: the Talk line in a real browser with the
// phone's speech recogniser, vibration and wake lock faked (its voice is voice-kit's honest synthesiser): hold to
// talk, a buzz on hold and release, the Mayor's answer shown and spoken, a tap that
// cuts it, and a long press on the Channels tab that opens the line.
import { test, expect, type Page } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { speechInitScript, type SpeechScriptOptions } from 'voice-kit/testing/speech';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { encryptMessage } from '../../src/services/messages';
import { encodeTurn } from '../../src/services/talk';
import { MAYOR } from '../support/cockpit-fixture';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot, sized } from './shot';

test.use({ serviceWorkers: 'block' });

declare global {
  interface Window {
    __hear(text: string): void;
    /** What was passed to speak(), in order: read off voice-kit's honest synthesiser. */
    readonly __spoken: string[];
    __cancels: number;
    __bsvKitTesting: { speech: { log: { text: string }[]; synth: { cancel(): void } } };
    __vibrations: number[];
    __locks: { requested: number; released: number };
  }
}

/** The faked browser speech, vibration and wake lock; `__hear` is what the recogniser hears. */
async function fakeSpeech(page: Page, voice: SpeechScriptOptions = {}): Promise<void> {
  await page.addInitScript(speechInitScript(voice));
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
    // The phone's voice is voice-kit's honest synthesiser (speechInitScript, added first); these read and count its calls.
    const { speech } = window.__bsvKitTesting;
    Object.defineProperty(window, '__spoken', { configurable: true, get: () => speech.log.map((entry) => entry.text) });
    window.__cancels = 0;
    const cancel = speech.synth.cancel.bind(speech.synth);
    speech.synth.cancel = () => {
      window.__cancels += 1;
      cancel();
    };
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

/** A voice that takes a minute over a short answer, for a test that taps Stop while it reads: the honest synthesiser ends a sentence in the time a phone takes. */
const SLOW_VOICE: SpeechScriptOptions = { msPerWord: 20_000 };

/** A talk stored on the phone before the test starts: each turn of his and the Mayor's answer, `daysAgo` days back. */
interface StoredTalk {
  id: string;
  daysAgo: number;
  turns: { said: string; answer: string }[];
}

async function unlocked(page: Page, history: StoredTalk[] = [], voice: SpeechScriptOptions = {}): Promise<{ posted: string[]; answerAfterTurn: (text: string) => void }> {
  await fakeSpeech(page, voice);
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
  // The stored talks come as records of the Mayor's feed: his turns sealed by him, the answers by the Mayor.
  const stored = history.flatMap((talk, index) =>
    talk.turns.flatMap((turn, number) => {
      const at = Math.floor(Date.now() / 1000) - talk.daysAgo * 86_400 + number * 60;
      const seal = (text: string, role: 'turn' | 'answer', mine: boolean, ts: number) => ({
        ...encryptMessage({
          text: encodeTurn({ talk: { id: talk.id, turn: number + 1 }, text, role }),
          class: 'talk',
          senderPrivateKeyHex: mine ? governor.toHex() : MAYOR.toHex(),
          recipientPublicKeyHex: mine ? MAYOR.toPublicKey().toString() : governor.toPublicKey().toString(),
        }),
        ts,
      });
      const base = 2000 + index * 100 + number * 2;
      return [
        { seq: base, txid: `direct:${String(base).padStart(64, 'a')}`, vout: 0, payload: seal(turn.said, 'turn', true, at) },
        { seq: base + 1, txid: `direct:${String(base + 1).padStart(64, 'b')}`, vout: 0, payload: seal(turn.answer, 'answer', false, at + 5) },
      ];
    }),
  );
  await page.route('**/api/messages**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const since = Number(new URL(route.request().url()).searchParams.get('since') ?? 0);
    if (stored.length > 0 && since < 2000) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records: stored, next: 2000 + history.length * 100 }) });
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

// the width the shots run is at (390 unless `npm run shots` is on another size): nothing may be wider than it
const PHONE_WIDTH = sized({ width: 390, height: 844 }).width;

test("talk line: the answer's own buttons sit beside its speaker, 44 px, in 390 px, with no separate bar (mw-q6n8m0.11)", async ({ page }) => {
  await page.setViewportSize(sized({ width: 390, height: 844 }));
  const { answerAfterTurn } = await unlocked(page, [], SLOW_VOICE);
  answerAfterTurn('Three things landed. Two are live. One waits for you.');

  await page.goto('/?v=line');
  const button = page.getByRole('button', { name: 'Hold to talk' });
  await expect(button).toBeEnabled();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByRole('button', { name: 'Release to send' })).toBeVisible();
  await page.evaluate(() => window.__hear('What landed today?'));
  await page.mouse.up();
  const answer = page.getByTestId('talk-answer');
  await expect(answer).toContainText('One waits for you.', { timeout: 20_000 });

  await expect(page.getByRole('region', { name: 'Speaking' })).toHaveCount(0);
  // the speech buttons, then Share (mw-q6n8m0.17), which is named by its text and measured below with the rest
  expect(await answer.getByRole('button').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? node.textContent))).toEqual(['Stop reading', 'Pause', 'Share']);
  await expect(answer).toContainText('Speaking…');
  await expect(page.getByTestId('talk-unheard')).toHaveCount(0);
  for (const control of await answer.getByRole('button').all()) {
    const size = (await control.boundingBox())!;
    expect(size.height).toBeGreaterThanOrEqual(44);
    expect(size.width).toBeGreaterThanOrEqual(44);
  }
  const holdBox = (await page.getByRole('button', { name: /Hold to talk|Waiting for the Mayor/ }).boundingBox())!;
  const answerBox = (await answer.boundingBox())!;
  expect(answerBox.x).toBeGreaterThanOrEqual(0);
  expect(answerBox.x + answerBox.width).toBeLessThanOrEqual(PHONE_WIDTH);
  expect(answerBox.y + answerBox.height).toBeLessThanOrEqual(holdBox.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE_WIDTH);
  await shot(page, 'talk-line-answer-speaking-390');

  await answer.getByRole('button', { name: 'Pause' }).click();
  expect(await answer.getByRole('button').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? node.textContent))).toEqual(['Resume reading', 'Resume', 'Restart', 'Share']);
  await expect(page.getByText('The answer is paused.')).toBeVisible();
  await expect(answer).toContainText('Not heard yet');
  await shot(page, 'talk-line-answer-paused-390');

  // mw-m7v5kc.2: leaving the line, the Shell's bar (voice-kit's, in Postern's colours) offers Resume, Restart and Stop, each 44 px high.
  await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: /Channels$/ }).click();
  const bar = page.getByRole('region', { name: 'Speaking' });
  await expect(bar.getByRole('button')).toHaveText(['Resume', 'Restart', 'Stop']);
  for (const control of await bar.getByRole('button').all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE_WIDTH);
  await shot(page, 'speaking-bar-paused-390');
});

test('talk line: hold to talk, a spoken answer with its timing, and a tap that cuts it', async ({ page }) => {
  const { posted, answerAfterTurn } = await unlocked(page, [], SLOW_VOICE);
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
  await expect(answered).toContainText('Three things landed.', { timeout: 20_000 });
  await expect(answered).toContainText(/first words in \d+\.\d s/);
  expect(await page.evaluate(() => window.__spoken)).toEqual(['Three things landed.']);
  await shot(page, 'talk-line-answer');

  const cancelsBefore = await page.evaluate(() => window.__cancels);
  await page.getByRole('button', { name: 'Stop reading', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop reading', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__cancels)).toBeGreaterThan(cancelsBefore);

  await page.getByRole('button', { name: 'End talk' }).click();
  await expect.poll(() => page.evaluate(() => window.__locks.released)).toBeGreaterThan(0);
  await expect.poll(() => posted.length).toBe(2);
});

// The press is timed by the page's clock (LONG_PRESS_MS, 500 ms), which the test holds still while it presses: a tap that
// takes this host 800 ms to deliver is still a tap, and a hold is exactly as long as the test lets the clock run, so the
// outcome does not depend on how fast a loaded host clicks (mw-gq6.679; the real clock this test used to race).
const LONG_PRESS_MS = 500; // src/cockpit/Shell.tsx (not imported: it pulls the whole app in)
const PAUSE_AHEAD_MS = 5_000;
async function pausedClock<T>(page: Page, press: () => Promise<T>): Promise<T> {
  await page.clock.pauseAt(new Date(Date.now() + PAUSE_AHEAD_MS));
  try {
    return await press();
  } finally {
    await page.clock.resume();
  }
}

test('the Channels tab: a short tap lists the channels, a long press opens the Talk line', async ({ page }) => {
  await unlocked(page);
  await page.clock.install();
  const tab = page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: /Channels$/ });

  await pausedClock(page, () => tab.click({ delay: 800 })); // slower than a long press on a real clock, still a tap on this one
  await expect(page).toHaveURL(/\?v=talk$/);
  await expect(page.getByRole('heading', { name: 'Channels' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Talk to the Mayor' })).toBeVisible();
  expect(await page.evaluate(() => window.__vibrations.length)).toBe(0);

  await page.goto('/?v=needs');
  const box = (await tab.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pausedClock(page, async () => {
    await page.mouse.down();
    await page.clock.runFor(LONG_PRESS_MS + 200);
    await page.mouse.up();
  });
  await expect(page).toHaveURL(/\?v=line$/);
  await expect(page.getByRole('button', { name: 'Hold to talk' })).toBeVisible();
  expect(await page.evaluate(() => window.__vibrations.length)).toBe(1);

  await page.goto('/?v=talk');
  await page.getByRole('button', { name: 'Talk to the Mayor' }).click();
  await expect(page).toHaveURL(/\?v=line$/);
  await shot(page, 'talk-line-idle');
});

// mw-j0f2d.13: an answer longer than the list is tall must still end up fully in view.
test('talk line: a long answer scrolls into view instead of landing below the fold', async ({ page }) => {
  const { posted, answerAfterTurn } = await unlocked(page);
  const long = Array.from({ length: 40 }, (_, i) => `Sentence ${i + 1} of a long answer.`).join(' ');
  answerAfterTurn(long);

  await page.goto('/?v=line');
  const button = page.getByRole('button', { name: 'Hold to talk' });
  await expect(button).toBeEnabled();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByRole('button', { name: 'Release to send' })).toBeVisible();
  await page.evaluate(() => window.__hear('Tell me everything'));
  await page.mouse.up();
  await expect.poll(() => posted.length).toBe(1);

  const answer = page.getByTestId('talk-answer');
  await expect(answer).toContainText('Sentence 40', { timeout: 20_000 });
  const list = page.getByTestId('talk-scroll');
  // the smooth scroll takes a moment: the answer's last line ends up inside the list's box
  await expect
    .poll(async () => {
      const [a, l] = await Promise.all([answer.boundingBox(), list.boundingBox()]);
      return a!.y + a!.height <= l!.y + l!.height + 1;
    })
    .toBe(true);
  await expect(page.getByRole('button', { name: 'New answer' })).toHaveCount(0);
});

// mw-j0f2d.23: on a phone the newest answer's last line sits fully above the bottom controls,
// also once the controls change height (the status line wraps, a button appears) after it lands.
test.describe('phone viewport', () => {
  test.use({ viewport: sized({ width: 412, height: 915 }) });

  test('talk line: the newest answer is not clipped by the controls', async ({ page }) => {
    const { posted, answerAfterTurn } = await unlocked(page);
    const long = Array.from({ length: 60 }, (_, i) => `Sentence ${i + 1} of a long answer.`).join(' ');
    answerAfterTurn(long);

    await page.goto('/?v=line');
    const button = page.getByRole('button', { name: 'Hold to talk' });
    await expect(button).toBeEnabled();
    const box = (await button.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.getByRole('button', { name: 'Release to send' })).toBeVisible();
    await page.evaluate(() => window.__hear('Tell me everything'));
    await page.mouse.up();
    await expect.poll(() => posted.length).toBe(1);
    await expect(page.getByTestId('talk-answer')).toContainText('Sentence 60', { timeout: 20_000 });

    // how far the answer's last rendered line reaches below the top of the controls (<= 0: fully above)
    const overlap = () =>
      page.evaluate(() => {
        const text = document.querySelector('[data-testid="talk-answer"] p')!;
        const range = document.createRange();
        range.selectNodeContents(text);
        const rects = [...range.getClientRects()];
        const lastBottom = Math.max(...rects.map((rect) => rect.bottom));
        return lastBottom - document.querySelector('[data-testid="talk-controls"]')!.getBoundingClientRect().top;
      });
    await expect.poll(overlap).toBeLessThanOrEqual(0);

    // the controls grow after the answer (a long failure notice wraps): the answer still ends above them
    await page.evaluate(() => {
      const status = document.querySelector('[data-testid="talk-controls"] [role="status"]')!;
      const note = document.createElement('p');
      note.textContent = 'x '.repeat(200);
      status.appendChild(note);
    });
    await expect.poll(overlap).toBeLessThanOrEqual(0);
    await shot(page, 'talk-line-long-answer');
  });
});

// mw-j0f2d.28: the small mark of whether the Mayor is here (the backend says so while his
// `mw talk wait` holds the event stream open), and one buzz when he is back after a missed turn.
async function presenceIs(page: Page): Promise<(here: boolean) => Promise<void>> {
  let here = false;
  await page.route('**/api/presence', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mayor: here }) }));
  // The screen asks again when the phone comes back to the foreground, which is quicker than waiting for its poll.
  return async (next) => {
    here = next;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  };
}

test('talk line: a dot says Mayor here or Mayor away, grey while no wait of his is connected', async ({ page }) => {
  await unlocked(page);
  const setHere = await presenceIs(page);

  await page.goto('/?v=line');
  const mark = page.getByTestId('mayor-presence');
  await expect(mark).toHaveText('Mayor away');
  await expect(mark.locator('span')).toHaveClass(/bg-faint/);
  await shot(page, 'talk-line-mayor-away');

  await setHere(true);
  await expect(mark).toHaveText('Mayor here');
  await expect(mark.locator('span')).toHaveClass(/bg-done/);
  await shot(page, 'talk-line-mayor-here');

  await setHere(false); // a handoff: no wait connected
  await expect(mark).toHaveText('Mayor away');
  expect(await page.evaluate(() => window.__vibrations.length)).toBe(0);
});

test('talk line: after a missed turn the phone buzzes once when the mark turns to Mayor here', async ({ page }) => {
  const { posted } = await unlocked(page);
  const setHere = await presenceIs(page);
  await setHere(true);

  await page.goto('/?v=line');
  const mark = page.getByTestId('mayor-presence');
  await expect(mark).toHaveText('Mayor here');
  await page.clock.install();

  const button = page.getByRole('button', { name: 'Hold to talk' });
  await expect(button).toBeEnabled();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByRole('button', { name: 'Release to send' })).toBeVisible();
  await page.evaluate(() => window.__hear('What landed today?'));
  await page.mouse.up();
  await expect.poll(() => posted.length).toBe(1);
  await expect(page.getByText('Sent.')).toBeVisible();

  await page.clock.fastForward(9_000);
  await expect(page.getByText('The Mayor is thinking…')).toBeVisible();

  await page.clock.fastForward(82_000);
  await expect(page.getByText('The Mayor has not answered yet. If it lands, it will play.')).toBeVisible();
  const buzzes = () => page.evaluate(() => window.__vibrations.length);
  const before = await buzzes();

  await setHere(false);
  await expect(mark).toHaveText('Mayor away');
  expect(await buzzes()).toBe(before);

  await setHere(true);
  await expect(mark).toHaveText('Mayor here');
  await expect.poll(buzzes).toBe(before + 1);
  await shot(page, 'talk-line-mayor-back');
});

// mw-nqur1n.6: a Talk button on a Needs card opens the line about it, with a Clear.
test('talk line: Talk on a card opens the line about it, and Clear drops it', async ({ page }) => {
  await unlocked(page);
  const card = page.getByTestId('need-card').first();
  const title = (await card.getByRole('link').first().textContent())!.trim();
  await card.getByRole('button', { name: 'Talk' }).last().click();
  await expect(page).toHaveURL(/\?v=line&/);
  const about = page.getByTestId('talk-about');
  await expect(about).toContainText(`About: ${title}`);
  await shot(page, 'line-about');

  await about.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByTestId('talk-about')).toHaveCount(0);
});

// mw-am3yjh.1: the talk is rebuilt from its stored rows, so leaving the screen or reloading keeps it.
test('talk line: the talk is still on the screen after Channels and back, and after a reload', async ({ page }) => {
  const { posted, answerAfterTurn } = await unlocked(page, [], SLOW_VOICE);
  answerAfterTurn('Three things landed.');

  await page.goto('/?v=line');
  const button = page.getByRole('button', { name: 'Hold to talk' });
  await expect(button).toBeEnabled();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByRole('button', { name: 'Release to send' })).toBeVisible();
  await page.evaluate(() => window.__hear('What landed today?'));
  await page.mouse.up();
  await expect.poll(() => posted.length).toBe(1);
  await expect(page.getByTestId('talk-answer')).toContainText('Three things landed.', { timeout: 20_000 });
  // he stops it: an answer he has stopped counts as heard and is not played again
  await page.getByRole('button', { name: 'Stop reading', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__spoken.length)).toBe(1);

  const talkIsThere = async () => {
    await expect(page.getByTestId('talk-said')).toHaveText('What landed today?');
    await expect(page.getByTestId('talk-answer')).toContainText('Three things landed.');
    await expect(page.getByTestId('talk-turn')).toHaveCount(1);
    await expect(page.getByTestId('talk-unheard')).toHaveCount(0);
  };

  await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: /Channels$/ }).click();
  await expect(page.getByRole('heading', { name: 'Channels' })).toBeVisible();
  await page.getByRole('button', { name: 'Talk to the Mayor' }).click();
  await expect(page).toHaveURL(/\?v=line$/);
  await talkIsThere();
  await shot(page, 'talk-line-back-from-channels');

  await page.reload();
  await talkIsThere();
  // the reload starts the page over; nothing was spoken again after it, nor on the way back
  expect(await page.evaluate(() => window.__spoken)).toEqual([]);
});

// mw-am3yjh.2: his earlier talks sit above the open one on the same screen, a page of talks at a time.
test('talk line: earlier talks are above the open one, the screen opens on its newest turn, and scrolling up shows them', async ({ page }) => {
  const history: StoredTalk[] = Array.from({ length: 7 }, (_, i) => ({
    id: `talk-old-${i + 1}`,
    daysAgo: 9 - i,
    turns: [
      { said: `Old question ${i + 1}a`, answer: `Old answer ${i + 1}a: a few sentences so that each earlier talk takes a fair share of the phone's screen and the list has to scroll.` },
      { said: `Old question ${i + 1}b`, answer: `Old answer ${i + 1}b: and a second answer to the same talk, as long as the first one was, for the same reason.` },
    ],
  }));
  history.push({ id: 'talk-open', daysAgo: 0, turns: [{ said: 'Any news today?', answer: 'Nothing new since this morning.' }] });
  await unlocked(page, history, SLOW_VOICE);
  // the Talk screen reads the open talk back once, as it opens: let the rows reach the phone first
  const rows = history.reduce((sum, talk) => sum + talk.turns.length * 2, 0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const open = indexedDB.open('PosternDB');
            open.onsuccess = () => {
              const all = open.result.transaction('messages').objectStore('messages').getAll();
              all.onsuccess = () => resolve((all.result as { class: string }[]).filter((row) => row.class === 'talk').length);
            };
          }),
      ),
    )
    .toBe(rows);

  await page.goto('/?v=line');
  const scroller = page.getByTestId('talk-scroll');
  // the open talk's newest turn is in view, and the list is at its end
  await expect(page.getByTestId('talk-answer')).toContainText('Nothing new since this morning.');
  await expect(page.getByTestId('talk-answer')).toBeInViewport();
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(60);
  // the push-to-talk button is where it was
  await expect(page.getByRole('button', { name: 'Hold to talk' })).toBeInViewport();
  await shot(page, 'talk-line-with-history');

  // a page of five earlier talks is on the screen; the two oldest wait
  const earlier = page.getByTestId('talk-earlier');
  await expect(earlier).toHaveCount(5);
  await expect(page.getByTestId('talk-earlier-said').first()).toHaveText('Old question 3a');

  // scrolling up shows an earlier talk's divider and turns
  await scroller.evaluate((el) => (el.scrollTop = 0));
  await expect(earlier).toHaveCount(7);
  await scroller.evaluate((el) => (el.scrollTop = 0));
  const oldest = earlier.first();
  await expect(oldest.getByTestId('talk-divider')).toBeInViewport();
  await expect(oldest.getByTestId('talk-divider')).toContainText(/\d{2}:\d{2}/);
  await expect(oldest.getByTestId('talk-earlier-said').first()).toHaveText('Old question 1a');
  await expect(oldest.getByTestId('talk-earlier-answer').first()).toContainText('Old answer 1a');
  await shot(page, 'talk-line-history-top');

  // an earlier answer has its speaker button: tap to read it, tap again to stop
  const speaker = oldest.getByRole('button', { name: 'Read the answer aloud' }).first();
  await speaker.click();
  await expect.poll(() => page.evaluate(() => window.__spoken.at(-1))).toContain('Old answer 1a');
  await expect(oldest.getByRole('button', { name: 'Stop reading' })).toBeVisible();
  const cancels = await page.evaluate(() => window.__cancels);
  await oldest.getByRole('button', { name: 'Stop reading' }).click();
  await expect(oldest.getByRole('button', { name: 'Stop reading' })).toHaveCount(0);
  expect(await page.evaluate(() => window.__cancels)).toBeGreaterThan(cancels);
});

// mw-am3yjh.3: the Mayor's answer comes while he is on Channels: a bar says so, and a tap opens the Talk line with it.
test.describe('phone viewport: the answer bar', () => {
  test.use({ viewport: sized({ width: 390, height: 844 }) });

  test('talk line: an answer that arrives on Channels shows a bar, and the tap lands on the Talk line with the answer', async ({ page }) => {
    const { posted, answerAfterTurn } = await unlocked(page);

    await page.goto('/?v=line');
    const button = page.getByRole('button', { name: 'Hold to talk' });
    await expect(button).toBeEnabled();
    const box = (await button.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.getByRole('button', { name: 'Release to send' })).toBeVisible();
    await page.evaluate(() => window.__hear('What landed today?'));
    await page.mouse.up();
    await expect.poll(() => posted.length).toBe(1);

    // he holds a turn and goes to Channels; only then does the Mayor's answer come
    await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: /Channels$/ }).click();
    await expect(page.getByRole('heading', { name: 'Channels' })).toBeVisible();
    answerAfterTurn('Three things landed.');

    const bar = page.getByRole('button', { name: 'Mayor answered, tap to hear' });
    await expect(bar).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => window.__spoken)).toEqual([]);
    await shot(page, 'talk-answer-bar');

    await bar.click();
    await expect(page).toHaveURL(/\?v=line$/);
    await expect(page.getByTestId('talk-answer')).toContainText('Three things landed.');
    await expect.poll(() => page.evaluate(() => window.__spoken)).toEqual(['Three things landed.']);
    await expect(bar).toHaveCount(0);
  });
});

// a 2×2 red PNG
const RED_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z8Dwn4GBgYEBAB8CAgFsrJ/LAAAAAElFTkSuQmCC', 'base64');

test('talk line: a screenshot attached on the Talk screen goes with the turn and shows in its bubble (mw-q6n8m0.14)', async ({ page }) => {
  await page.setViewportSize(sized({ width: 390, height: 844 }));
  const width = page.viewportSize()?.width ?? PHONE_WIDTH;
  const { posted } = await unlocked(page);
  let uploads = 0;
  await page.route('**/api/blobs', (route) => {
    uploads += 1;
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ hash: 'ab'.repeat(32), size: 120 }) });
  });

  await page.goto('/?v=line');
  const attach = page.getByRole('button', { name: 'Attach', exact: true });
  const camera = page.getByRole('button', { name: 'Take a photo' });
  await expect(attach).toBeVisible();
  await expect(camera).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeHidden();

  // the picture shows as a thumbnail above the hold button, with Remove and, nothing said yet, Send
  await page.locator('input[type="file"]:not([capture])').setInputFiles({ name: 'screen.png', mimeType: 'image/png', buffer: RED_PNG });
  const thumb = page.getByTestId('talk-attached').getByRole('img', { name: 'Attached picture' });
  await expect(thumb).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  const hold = (await page.getByRole('button', { name: 'Hold to talk' }).boundingBox())!;
  const row = (await page.getByTestId('talk-picture-row').boundingBox())!;
  expect(row.y + row.height).toBeLessThanOrEqual(hold.y);
  expect(row.x).toBeGreaterThanOrEqual(0);
  expect(row.x + row.width).toBeLessThanOrEqual(width);
  for (const control of [attach, camera, page.getByRole('button', { name: 'Send', exact: true })]) {
    const box = (await control.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.height).toBeGreaterThanOrEqual(40);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await shot(page, 'talk-line-picture-attached');

  // hold, say one line, release: the words and the thumbnail are his bubble
  const button = page.getByRole('button', { name: 'Hold to talk' });
  const box = (await button.boundingBox())!;
  const before = posted.length;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByRole('button', { name: 'Release to send' })).toBeVisible();
  await page.evaluate(() => window.__hear('What is wrong in this screenshot?'));
  await page.mouse.up();
  const turn = page.getByTestId('talk-turn').first();
  await expect(turn.getByTestId('talk-said')).toHaveText('What is wrong in this screenshot?');
  const bubble = turn.getByRole('img', { name: 'Attached picture' });
  await expect(bubble).toBeVisible();
  // the picture has loaded and has a size to look at, even a 2 px one
  await expect.poll(async () => (await bubble.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(40);
  expect(await bubble.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect.poll(() => posted.length).toBeGreaterThan(before);
  expect(uploads).toBe(1);
  // the picture is spent: no thumbnail row item and no Send
  await expect(page.getByTestId('talk-attached')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await shot(page, 'talk-line-picture-sent');
});
