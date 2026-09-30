// features/steps/notification-tap.steps.tsx — runs features/notification-tap.feature
// under vitest via @amiceli/vitest-cucumber. The real src/sw.ts is loaded under
// jsdom (tests/support/sw-harness.ts) and sent a push and then a notificationclick;
// where its tap opened is then rendered through the app's own router, so the
// scenarios end at the screen the Governor would see.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { db, type MessageClass, type MessageRow } from '../../src/data/db';
import { messagesRepo } from '../../src/data/repositories';
import { parseRoute } from '../../src/nav/route';
import { NoticeScreen } from '../../src/cockpit/NoticeScreen';
import { AlarmScreen } from '../../src/cockpit/AlarmScreen';
import { fakeWindowClient, loadWorker, type FakeWindowClient, type WorkerHarness } from '../../tests/support/sw-harness';

const TXID = 'ab'.repeat(32);

function messageOn(bead: string): MessageRow {
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
    plaintext: JSON.stringify({ thread: { bead }, text: 'a word about the library' }),
    direction: 'received',
    read: false,
    thread: `bead:${bead}`,
  };
}

const POST = `direct:${'a1'.repeat(32)}`;

function generalRow(txid: string, body: object | string): MessageRow {
  return { ...messageOn('x'), id: `${txid}:0`, txid, thread: undefined, plaintext: typeof body === 'string' ? body : JSON.stringify(body) };
}
const replyRow = () => generalRow(TXID, { text: 'the answer', re: POST });
const replyThread = { view: 'talk', thread: 'general', root: POST } as const;

let worker: WorkerHarness;
let appWindow: FakeWindowClient | undefined;
let tappedUrl: string | undefined;

function openedUrl(): string {
  const opened = worker.openWindow.mock.calls[0]?.[0] as string | undefined;
  if (opened) return opened;
  const told = appWindow?.postMessage.mock.calls.map((call) => call[0] as { type: string; url?: string }).find((message) => message.type === 'open');
  return told?.url ?? '';
}

async function arrive(messageClass: MessageClass): Promise<void> {
  await worker.push({ class: messageClass, txid: TXID, ts: 1_790_000_000 });
}

async function fresh(): Promise<void> {
  cleanup();
  await db.messages.clear();
  appWindow = undefined;
  tappedUrl = undefined;
  worker = await loadWorker();
}

async function tap(): Promise<void> {
  const shown = worker.shown.at(-1);
  expect(shown).toBeDefined();
  await worker.click({ data: shown!.options.data });
  tappedUrl = openedUrl();
}

const feature = await loadFeature('features/notification-tap.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  Scenario('mw-f758y.25 AC-1: a message push whose message is already here opens that bead\'s thread', ({ Given, And, When, Then }) => {
    Given('the phone already holds a decrypted message on the thread of bead {string}', async (_ctx, bead: string) => {
      await messagesRepo.put(messageOn(bead));
    });
    And("the Mayor's message push for that message arrives", () => arrive('message'));
    When('he taps the notification', tap);
    Then('the app opens at the thread of bead {string}', (_ctx, bead: string) => {
      expect(worker.openWindow).toHaveBeenCalledTimes(1);
      expect(parseRoute(new URL(tappedUrl!, 'https://postern.allmymind.org').search)).toEqual({ view: 'talk', thread: `bead:${bead}` });
    });
  });

  Scenario('mw-f758y.25 AC-2: a tap with the app already open focuses it and sends it to the thread', ({ Given, And, When, Then }) => {
    Given('the phone already holds a decrypted message on the thread of bead {string}', async (_ctx, bead: string) => {
      await messagesRepo.put(messageOn(bead));
    });
    And("the Mayor's message push for that message arrives", () => arrive('message'));
    And('the app is already open', () => {
      appWindow = fakeWindowClient();
      worker.openWindows.push(appWindow);
    });
    When('he taps the notification', tap);
    Then('the open app is focused and told to go to the thread of bead {string}', (_ctx, bead: string) => {
      expect(appWindow!.focus).toHaveBeenCalled();
      expect(worker.openWindow).not.toHaveBeenCalled();
      expect(parseRoute(new URL(tappedUrl!, 'https://postern.allmymind.org').search)).toEqual({ view: 'talk', thread: `bead:${bead}` });
    });
  });

  Scenario('mw-f758y.25 AC-3: a watchdog alarm push opens the alarm itself', ({ Given, When, Then }) => {
    Given('the watchdog pushes the alarm {string} with the body {string}', async (_ctx, title: string, body: string) => {
      await worker.push({ class: 'alarm', ts: 1_790_000_000, title, body });
    });
    When('he taps the notification', tap);
    Then('the app opens at an alarm screen showing {string} and {string}', async (_ctx, title: string, body: string) => {
      expect(worker.openWindow).toHaveBeenCalledTimes(1);
      const route = parseRoute(new URL(tappedUrl!, 'https://postern.allmymind.org').search);
      expect(route.view).toBe('alarm');
      if (route.view !== 'alarm') return;
      render(<AlarmScreen title={route.title} body={route.body} ts={route.ts} />);
      expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
      expect(screen.getByText(body)).toBeInTheDocument();
    });
  });

  Scenario('mw-f758y.25 AC-4: a message the phone has not fetched yet lands on a screen that moves to its thread once it arrives', ({ Given, When, And, Then }) => {
    Given('the Mayor\'s message push arrives for a message the phone does not hold yet', () => arrive('message'));
    When('he taps the notification', tap);
    And('the app opens where the notification pointed', () => {
      window.history.replaceState(null, '', tappedUrl!);
      const route = parseRoute(window.location.search);
      expect(route).toMatchObject({ view: 'notice', tx: TXID });
      if (route.view !== 'notice') return;
      render(<NoticeScreen tx={route.tx} cls={route.cls} />);
    });
    And('the message arrives and decrypts on the thread of bead {string}', async (_ctx, bead: string) => {
      await messagesRepo.put(messageOn(bead));
    });
    Then('the app moves to the thread of bead {string}', async (_ctx, bead: string) => {
      await waitFor(() => expect(parseRoute(window.location.search)).toEqual({ view: 'talk', thread: `bead:${bead}` }));
    });
  });

  Scenario('mw-f758y.25 AC-5: a message that never arrives falls back to where its class belongs', ({ Given, When, And, Then }) => {
    Given("the Mayor's decision push arrives for a message the phone does not hold yet", () => arrive('decision-needed'));
    When('he taps the notification', tap);
    And('the app opens where the notification pointed', () => {
      window.history.replaceState(null, '', tappedUrl!);
      const route = parseRoute(window.location.search);
      expect(route).toMatchObject({ view: 'notice', tx: TXID, cls: 'decision-needed' });
      if (route.view !== 'notice') return;
      render(<NoticeScreen tx={route.tx} cls={route.cls} waitMs={50} />);
    });
    And('the message does not arrive in time', () => new Promise((resolve) => setTimeout(resolve, 120)));
    Then('the app moves to the Needs-you queue', async () => {
      await waitFor(() => expect(parseRoute(window.location.search)).toEqual({ view: 'needs' }));
    });
  });

  Scenario('mw-gq6.160 AC-6: a push for a reply whose message is already here opens the reply thread of the post it answers', ({ Given, And, When, Then }) => {
    Given("the phone already holds a General post and the Mayor's reply to it", async () => {
      await messagesRepo.put(generalRow(POST, 'the post'));
      await messagesRepo.put(replyRow());
    });
    And("the Mayor's message push for that reply arrives", () => arrive('message'));
    When('he taps the notification', tap);
    Then('the app opens at the reply thread of the General post', () => {
      expect(parseRoute(new URL(tappedUrl!, 'https://postern.allmymind.org').search)).toEqual(replyThread);
    });
  });

  Scenario('mw-gq6.160 AC-7: a push for a reply not fetched yet lands on a screen that moves to the reply thread once it arrives', ({ Given, And, When, Then }) => {
    Given('the phone holds a General post', async () => {
      await messagesRepo.put(generalRow(POST, 'the post'));
    });
    And("the Mayor's message push arrives for a reply the phone does not hold yet", () => arrive('message'));
    When('he taps the notification', tap);
    And('the app opens where the notification pointed', () => {
      window.history.replaceState(null, '', tappedUrl!);
      const route = parseRoute(window.location.search);
      expect(route).toMatchObject({ view: 'notice', tx: TXID });
      if (route.view !== 'notice') return;
      render(<NoticeScreen tx={route.tx} cls={route.cls} />);
    });
    And('the reply arrives and decrypts', async () => {
      await messagesRepo.put(replyRow());
    });
    Then('the app moves to the reply thread of the General post', async () => {
      await waitFor(() => expect(parseRoute(window.location.search)).toEqual(replyThread));
    });
  });
});

beforeAll(() => {
  window.history.replaceState(null, '', '/');
});
afterAll(cleanup);
