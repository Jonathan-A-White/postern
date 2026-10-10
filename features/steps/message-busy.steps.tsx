// features/steps/message-busy.steps.tsx — runs features/message-busy.feature (mw-qkb7yp): a message on a backend without
// direct delivery goes out as a transaction through /api/broadcast. The real outbox, deliver and send run; only the
// network is doubled, and the broadcast answers what the backend would when WhatsOnChain is busy or refuses.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Transaction, PrivateKey } from '@bsv/sdk';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { db } from '../../src/data/db';
import { forgetOutboxState, settledOutbox, startOutbox } from '../../src/services/outbox';
import { settledWrites } from '../../src/services/deliver';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

configure({ asyncUtilTimeout: 5000 });

const KEY = new Uint8Array(Array.from({ length: 32 }, () => 0x45));
const MAYOR = PrivateKey.fromHex('77'.repeat(32)).toPublicKey().toString();

vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  // A backend without direct delivery: the message goes out as a funded transaction.
  deliverOptions: () => ({ key: KEY, mayorKey: MAYOR, direct: false }),
}));
vi.mock('../../src/services/keySession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/keySession')>()),
  getKey: () => KEY,
}));

const PAGE_429 = '<html> <head> <title>429 Too Many Requests</title> </head> <body>nginx/1.18.0 (Ubuntu)</body> </html>';
const PAGE_500 = `<html><head><title>500 Internal Server Error</title></head><body><center><h1>500</h1></center>${'x'.repeat(220)}</body></html>`;

type Answer = { status: number; error?: string };
const BUSY: Answer = { status: 502, error: `WhatsOnChain said 429: ${PAGE_429}` };
const TAKEN: Answer = { status: 200 };

/** What the next broadcasts answer, in order; the last answer repeats. */
let answers: Answer[] = [];
let broadcasts = 0;
let stopOutbox: (() => void) | undefined;

function stubNetwork(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (isChallengeRequest(url)) return challengeResponse();
      if (url.includes('/utxos/')) return new Response(JSON.stringify({ utxos: [{ txid: 'a'.repeat(64), vout: 0, satoshis: 10_000 }] }), { status: 200 });
      if (url.endsWith('/broadcast')) {
        const answer = answers[Math.min(broadcasts, answers.length - 1)];
        broadcasts++;
        if (answer.status === 200) {
          const { rawtx } = JSON.parse(String(init?.body)) as { rawtx: string };
          return new Response(JSON.stringify({ txid: Transaction.fromHex(rawtx).id('hex') }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: answer.error }), { status: answer.status });
      }
      return new Response('not found', { status: 404 });
    }),
  );
}

async function fresh(): Promise<void> {
  cleanup();
  stopOutbox?.();
  forgetOutboxState();
  answers = [];
  broadcasts = 0;
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.messages.clear(), db.events.clear(), db.outbox.clear(), db.pendingSpends.clear()]);
  window.history.replaceState(null, '', '/?v=talk');
  stubNetwork();
  stopOutbox = startOutbox();
}

afterAll(async () => {
  stopOutbox?.();
  forgetOutboxState();
  await settledWrites();
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

async function online(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event('online'));
    await settledOutbox();
  });
}

const bubbleOf = (words: string) => within(screen.getByTestId('conversation')).getByText(words).closest('[data-testid="message"]') as HTMLElement;

function openChannel(name: string): void {
  window.history.replaceState(null, '', `/?v=talk&t=${encodeURIComponent(`topic:${name}`)}`);
  render(<TalkScreen thread={`topic:${name}`} />);
}

async function sendFromComposer(words: string): Promise<void> {
  fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: words } });
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));
}

/** The line under the message, once it has settled to `line`. */
async function lineUnder(words: string, line: string): Promise<void> {
  await waitFor(() => expect(within(bubbleOf(words)).getByTestId('outbox-note')).toHaveTextContent(line));
}

function nothingOfTheirs(said: string): void {
  expect(document.body).not.toHaveTextContent('nginx');
  expect(document.body).not.toHaveTextContent('Too Many Requests');
  expect(document.body).not.toHaveTextContent('<html');
  expect(document.body).not.toHaveTextContent(said);
}

const feature = await loadFeature('features/message-busy.feature');

describeFeature(feature, ({ BeforeEachScenario, Scenario }) => {
  BeforeEachScenario(fresh);

  Scenario('mw-qkb7yp AC-1: a busy broadcast twice then taken sends the message, with the busy line in between', ({ Given, And, When, Then }) => {
    Given("the backend takes messages only as transactions and its broadcast answers WhatsOnChain's busy 502 twice, then takes it", () => {
      answers = [BUSY, BUSY, TAKEN];
    });
    And('the Talk channel {string} is open', (_c, name: string) => openChannel(name));
    When('he sends {string} from the composer', async (_c, words: string) => sendFromComposer(words));
    Then('the thread shows {string} with the line {string}', async (_c, words: string, line: string) => lineUnder(words, line));
    And("the screen shows none of WhatsOnChain's page and no {string}", (_c, said: string) => nothingOfTheirs(said));
    When('the phone hears it is online again', online);
    Then('the line under {string} still reads {string}', async (_c, words: string, line: string) => lineUnder(words, line));
    When('the phone hears it is online once more', online);
    Then('the broadcast has been tried three times', async () => {
      await waitFor(() => expect(broadcasts).toBe(3));
    });
    And('the thread shows {string} with no line about WhatsOnChain', async (_c, words: string) => {
      await waitFor(() => expect(within(bubbleOf(words)).queryByTestId('outbox-note')).toBeNull());
    });
    And('the page of WhatsOnChain and {string} are still nowhere on the screen', (_c, said: string) => nothingOfTheirs(said));
  });

  Scenario('mw-qkb7yp AC-2: a broadcast that stays busy keeps one plain line under the message', ({ Given, And, When, Then }) => {
    Given("the backend takes messages only as transactions and its broadcast answers WhatsOnChain's busy 502 every time", () => {
      answers = [BUSY];
    });
    And('the Talk channel {string} is open', (_c, name: string) => openChannel(name));
    When('he sends {string} from the composer', async (_c, words: string) => sendFromComposer(words));
    And('the phone hears it is online again', online);
    And('the phone hears it is online once more', online);
    Then('the thread shows {string} with the line {string}', async (_c, words: string, line: string) => lineUnder(words, line));
    And('the thread shows that line once', () => {
      expect(screen.getAllByTestId('outbox-note')).toHaveLength(1);
    });
    And("the screen shows none of WhatsOnChain's page and no {string}", (_c, said: string) => nothingOfTheirs(said));
  });

  Scenario('mw-qkb7yp AC-2: a provider page on a 500 becomes one plain line', ({ Given, And, When, Then }) => {
    Given("the backend takes messages only as transactions and its broadcast answers a 502 relaying WhatsOnChain's 500 page every time", () => {
      answers = [{ status: 502, error: `WhatsOnChain said 500: ${PAGE_500}` }];
    });
    And('the Talk channel {string} is open', (_c, name: string) => openChannel(name));
    When('he sends {string} from the composer', async (_c, words: string) => sendFromComposer(words));
    Then('the thread shows {string} with the line {string}', async (_c, words: string, line: string) => lineUnder(words, line));
    And("the screen shows none of WhatsOnChain's page and no {string}", (_c, said: string) => nothingOfTheirs(said));
  });

  Scenario('mw-qkb7yp AC-2: a broadcast the backend refuses for good says so in its words, with Retry and Discard', ({ Given, And, When, Then }) => {
    Given('the backend takes messages only as transactions and its broadcast answers 400 {string}', (_c, why: string) => {
      answers = [{ status: 400, error: why }];
    });
    And('the Talk channel {string} is open', (_c, name: string) => openChannel(name));
    When('he sends {string} from the composer', async (_c, words: string) => sendFromComposer(words));
    Then('the thread shows {string} marked {string} with Retry and Discard', async (_c, words: string, note: string) => {
      await waitFor(() => {
        const bubble = bubbleOf(words);
        expect(within(bubble).getByTestId('failed-note')).toHaveTextContent(note);
        expect(within(bubble).getByRole('button', { name: 'Retry' })).toBeEnabled();
        expect(within(bubble).getByRole('button', { name: 'Discard' })).toBeEnabled();
      });
    });
  });
});
