// features/steps/push-seen.steps.tsx — runs features/push-seen.feature (mw-gq6.166).
// The real src/sw.ts (tests/support/sw-harness.ts) is sent pushes while a fake
// window stands for the open app: it answers the worker's 'seen?' with the app's
// own answerSeen() against the route the scenario put in the address bar, so
// worker and app are tested as the pair they are. Opening a channel renders the
// real TalkScreen, whose read-marking tells the worker what is on screen.
import '@testing-library/react/dont-cleanup-after-each';
import { render, cleanup, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { db, type MessageClass, type MessageRow } from '../../src/data/db';
import { messagesRepo } from '../../src/data/repositories';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { topicKey } from '../../src/cockpit/topicKey';
import { formatRoute } from '../../src/nav/route';
import { answerSeen } from '../../src/services/seen';
import { fakeWindowClient, loadWorker, type FakeWindowClient, type WorkerHarness } from '../../tests/support/sw-harness';

const TXID = 'cd'.repeat(32);

function messageIn(channel: string): MessageRow {
  return {
    id: `${TXID}:0`,
    txid: TXID,
    vout: 0,
    seq: 1,
    class: 'message',
    to: 'aa'.repeat(33),
    from: 'bb'.repeat(33),
    ts: 1_790_000_000,
    ciphertext: 'ct',
    plaintext: JSON.stringify({ thread: { topic: channel }, text: 'a word about the library' }),
    direction: 'received',
    read: false,
    thread: topicKey(channel),
  };
}

let worker: WorkerHarness;
let appWindow: FakeWindowClient;
let pending: Promise<void> | undefined;

function goTo(channel: string): void {
  window.history.replaceState(null, '', `/${formatRoute({ view: 'talk', thread: topicKey(channel) })}`);
}

/** The open app: it answers 'seen?' the way src/App.tsx does, from its address bar. */
function openApp(channel: string, focused = true): void {
  goTo(channel);
  appWindow = fakeWindowClient();
  appWindow.focused = focused;
  appWindow.postMessage.mockImplementation((message: { type: string; txid: string }) => {
    if (message.type === 'seen?') void answerSeen(message.txid).then((seen) => worker.deliver({ type: 'seen', txid: message.txid, seen }));
  });
  worker.openWindows.push(appWindow);
}

function arrive(messageClass: MessageClass = 'message'): Promise<void> {
  return worker.push({ class: messageClass, txid: TXID, ts: 1_790_000_000 });
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

async function fresh(): Promise<void> {
  cleanup();
  vi.useRealTimers();
  setVisibility('visible');
  await db.messages.clear();
  pending = undefined;
  window.history.replaceState(null, '', '/');
  worker = await loadWorker();
}

const feature = await loadFeature('features/push-seen.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  Scenario('mw-gq6.166 AC-1: a push for a message on the channel a focused window shows makes no notification and asks the app to sync', ({ Given, And, When, Then }) => {
    Given("the phone holds the Mayor's message in the channel {string}", (_ctx, channel: string) => messagesRepo.put(messageIn(channel)));
    And('the app is focused and open on the channel {string}', (_ctx, channel: string) => openApp(channel));
    When('the push for that message arrives', () => arrive());
    Then('no notification is shown', () => {
      expect(worker.shown).toHaveLength(0);
    });
    And('the app is told to sync its inbox', () => {
      expect(appWindow.postMessage).toHaveBeenCalledWith({ type: 'sync-inbox' });
    });
  });

  Scenario('mw-gq6.166 AC-2: a push with no focused window shows its notification', ({ Given, And, When, Then }) => {
    Given("the phone holds the Mayor's message in the channel {string}", (_ctx, channel: string) => messagesRepo.put(messageIn(channel)));
    And('the app is open on the channel {string} but not focused', (_ctx, channel: string) => openApp(channel, false));
    When('the push for that message arrives', () => arrive());
    Then('the notification is shown', () => {
      expect(worker.shown).toHaveLength(1);
      expect(appWindow.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'seen?' }));
    });
  });

  Scenario('mw-gq6.166 AC-3: a push for a channel other than the one on screen shows its notification', ({ Given, And, When, Then }) => {
    Given("the phone holds the Mayor's message in the channel {string}", (_ctx, channel: string) => messagesRepo.put(messageIn(channel)));
    And('the app is focused and open on the channel {string}', (_ctx, channel: string) => openApp(channel));
    When('the push for that message arrives', () => arrive());
    Then('the notification is shown', () => {
      expect(worker.shown).toHaveLength(1);
      expect(worker.shown[0].options.tag).toBe(TXID);
    });
  });

  Scenario('mw-gq6.166 AC-4: a push the app does not answer within 3 seconds shows its notification', ({ Given, When, And, Then }) => {
    Given('the app is focused and open but never answers', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      appWindow = fakeWindowClient();
      worker.openWindows.push(appWindow);
    });
    When('the push for a message arrives', async () => {
      pending = arrive();
      await vi.advanceTimersByTimeAsync(0);
      expect(worker.shown).toHaveLength(0);
    });
    And('3 seconds pass', async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await pending;
    });
    Then('the notification is shown', () => {
      expect(appWindow.postMessage).toHaveBeenCalledWith({ type: 'seen?', txid: TXID });
      expect(worker.shown).toHaveLength(1);
    });
  });

  Scenario('mw-gq6.166 AC-5: a shown notification is closed when the app renders its message', ({ Given, And, When, Then }) => {
    Given("the phone holds the Mayor's message in the channel {string}", (_ctx, channel: string) => messagesRepo.put(messageIn(channel)));
    And('the app is focused and open on the channel {string}', (_ctx, channel: string) => openApp(channel));
    And('the push for that message arrives', () => arrive());
    And('the notification is shown', () => {
      expect(worker.open).toHaveLength(1);
    });
    When('he opens the channel {string}', (_ctx, channel: string) => {
      goTo(channel);
      render(<TalkScreen thread={topicKey(channel)} />);
    });
    Then('the notification is closed', async () => {
      await waitFor(() => expect(worker.open).toHaveLength(0));
    });
  });

  Scenario("mw-gq6.166 AC-6: a decision card's push follows the same rule", ({ Given, And, When, Then }) => {
    Given("the phone holds the Mayor's message in the channel {string}", (_ctx, channel: string) => messagesRepo.put(messageIn(channel)));
    And('the app is focused and open on the channel {string}', (_ctx, channel: string) => openApp(channel));
    When('the push for that message arrives as a decision', () => arrive('decision-needed'));
    Then('no notification is shown', () => {
      expect(worker.shown).toHaveLength(0);
    });
  });

  Scenario('mw-gq6.166 AC-7: a message in a hidden app does not close its notification', ({ Given, And, When, Then }) => {
    Given("the phone holds the Mayor's message in the channel {string}", (_ctx, channel: string) => messagesRepo.put(messageIn(channel)));
    And('the app is focused and open on the channel {string}', (_ctx, channel: string) => openApp(channel));
    And('the push for that message arrives', () => arrive());
    And('the app is hidden', () => setVisibility('hidden'));
    When('he opens the channel {string}', async (_ctx, channel: string) => {
      goTo(channel);
      render(<TalkScreen thread={topicKey(channel)} />);
      await waitFor(async () => expect((await messagesRepo.getByTxid(TXID))?.read).toBe(true));
    });
    Then('the notification is still shown', () => {
      expect(worker.open).toHaveLength(1);
    });
  });
});

beforeAll(() => {
  // The worker's 'seen' messages reach src/sw.ts through the harness, as the real registration would carry them.
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve({ active: { postMessage: (data: unknown) => void worker.deliver(data) } }),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
});
afterAll(() => {
  cleanup();
  setVisibility('visible');
  window.history.replaceState(null, '', '/');
});
