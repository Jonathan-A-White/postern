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

/** A talk stored on the phone before the test starts: each turn of his and the Mayor's answer, `daysAgo` days back. */
interface StoredTalk {
  id: string;
  daysAgo: number;
  turns: { said: string; answer: string }[];
}

async function unlocked(page: Page, history: StoredTalk[] = []): Promise<{ posted: string[]; answerAfterTurn: (text: string) => void }> {
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

test('talk line: the speaking bar over the answer is 44 px high, fits 412 px and covers no text (mw-q6n8m0.9)', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 844 });
  const { answerAfterTurn } = await unlocked(page);
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
  await expect(answer).toContainText('One waits for you.', { timeout: 15_000 });

  const bar = page.getByRole('region', { name: 'Speaking' });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('button')).toHaveText(['Pause', 'Restart', 'Stop']);
  for (const control of await bar.getByRole('button').all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const barBox = (await bar.boundingBox())!;
  const answerBox = (await answer.boundingBox())!;
  expect(barBox.x).toBeGreaterThanOrEqual(0);
  expect(barBox.x + barBox.width).toBeLessThanOrEqual(412);
  expect(barBox.y >= answerBox.y + answerBox.height || barBox.y + barBox.height <= answerBox.y).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(412);

  await bar.getByRole('button', { name: 'Pause' }).click();
  await expect(bar.getByRole('button')).toHaveText(['Resume', 'Restart', 'Stop']);
  await expect(page.getByText('The answer is paused.')).toBeVisible();
  await shot(page, 'talk-line-speaking-bar-412');
});

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
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
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
  await expect(answer).toContainText('Sentence 40', { timeout: 15_000 });
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
  test.use({ viewport: { width: 412, height: 915 } });

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
    await expect(page.getByTestId('talk-answer')).toContainText('Sentence 60', { timeout: 15_000 });

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
  await page.mouse.up();
  await expect.poll(() => posted.length).toBe(1);
  await expect(page.getByTestId('talk-answer')).toContainText('Three things landed.', { timeout: 15_000 });
  // he stops it: an answer he has stopped counts as heard and is not played again
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
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
  await unlocked(page, history);
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
  test.use({ viewport: { width: 390, height: 844 } });

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
