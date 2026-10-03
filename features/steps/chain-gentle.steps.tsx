// features/steps/chain-gentle.steps.tsx — runs features/chain-gentle.feature (mw-jrx0s.20): the real
// live.ts loop and chain read against a faked anchor chain, fake timers; only the backend (apiFetch,
// the syncs, /me) is a double, and it stays out of reach.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { db } from '../../src/data/db';
import { CHAIN_POLL_MS, HEX_GAP_MS, MAX_TXS_PER_READ } from '../../src/services/chainRead';
import { startLive, stopLive } from '../../src/services/live';
import { fakeAnchorChain, publicKeyOf, recordTransaction, type FakeAnchorChain } from '../../tests/support/chain-record';

vi.mock('../../src/services/apiAuth', () => ({
  apiFetch: vi.fn(async () => {
    throw new Error('The network dropped.');
  }),
}));
vi.mock('../../src/services/inbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/inbox')>()),
  syncMessages: vi.fn(async () => {
    throw new Error('The backend did not answer.');
  }),
}));
vi.mock('../../src/services/view', () => ({
  refreshView: vi.fn(async () => {
    throw new Error('The backend did not answer.');
  }),
}));
vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: vi.fn(async () => ({ pubkey: '', mayor: '', network: 'testnet', features: ['events'] })),
  reconcileMayorKey: vi.fn(async () => ({ pinned: undefined, offered: undefined })),
}));
vi.mock('../../src/services/presence', () => ({ fetchMayorHere: () => Promise.resolve(undefined) }));

const PHONE_HEX = '07'.repeat(32);
const MAYOR_HEX = '77'.repeat(32);
const phoneKey = new Uint8Array(PrivateKey.fromHex(PHONE_HEX).toArray());

let chain: FakeAnchorChain;
let txids: string[] = [];
let pageHidden = false;
Object.defineProperty(document, 'hidden', { configurable: true, get: () => pageHidden });

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  }
}

/** Moves the clock in steps, letting Dexie and the faked network settle between them: a gap timer is only set once the fetch before it has been stored. */
async function advance(ms: number, step = ms): Promise<void> {
  for (let done = 0; done < ms; done += step) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(step, ms - done));
    });
    await flush();
  }
}

async function setUp(messages: number): Promise<void> {
  pageHidden = false;
  cleanup();
  stopLive();
  vi.useRealTimers();
  await db.messages.clear();
  await db.settings.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const txs = Array.from({ length: messages }, (_, i) =>
    recordTransaction({ senderHex: MAYOR_HEX, recipientPublicKeyHex: publicKeyOf(PHONE_HEX), class: 'message', plaintext: `gentle ${i}`, ts: 1_790_000_000 + i }),
  );
  txids = txs.map((tx) => tx.txid);
  chain = fakeAnchorChain(txs);
  vi.stubGlobal('fetch', chain.fetchImpl);
  await act(async () => {
    startLive(phoneKey);
    await vi.advanceTimersByTimeAsync(0);
  });
  await flush();
}

function messageOnChain(text: string) {
  return recordTransaction({ senderHex: MAYOR_HEX, recipientPublicKeyHex: publicKeyOf(PHONE_HEX), class: 'message', plaintext: text, ts: 1_790_100_000 });
}

const historyCalls = () => chain.calls.filter((url) => url.endsWith('/unconfirmed/history')).length;
const hexCalls = () => chain.calls.filter((url) => url.endsWith('/hex')).length;
const messagesOnPhone = () => db.messages.count();
/** One chain read of a full share: the poll wait, then the gaps between its fetches. */
const READ_MS = CHAIN_POLL_MS + (MAX_TXS_PER_READ - 1) * HEX_GAP_MS;

afterAll(() => {
  pageHidden = false;
  stopLive();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const feature = await loadFeature('features/chain-gentle.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-jrx0s.20 AC-1: reads back off while WhatsOnChain refuses, and go back to every 5 s once it answers', ({ Given, When, Then }) => {
    Given('the phone cannot reach the backend and WhatsOnChain answers 429', async () => {
      await setUp(0);
      chain.historyStatus = 429;
    });
    When('the phone has been out of reach for 70 seconds', async () => {
      await advance(70_000);
    });
    Then('WhatsOnChain was asked for the history 3 times', () => {
      // reads at 5 s, 15 s and 35 s: the waits doubled 5, 10, 20; the next is due at 75 s
      expect(historyCalls()).toBe(3);
    });
    When('WhatsOnChain answers again with a message on the anchor address and 11 more seconds pass', async () => {
      chain.historyStatus = undefined;
      chain.txs.push(messageOnChain('the answer'));
      await advance(11_000, 100);
    });
    Then('WhatsOnChain was asked for the history 5 times', () => {
      // a read at 75 s finds the message, so the next is at 80 s: back to every 5 s
      expect(historyCalls()).toBe(5);
      stopLive();
    });
  });

  Scenario('mw-jrx0s.20 AC-2: a long unread history is fetched a few transactions per read, the rest on the next', ({ Given, When, Then, And }) => {
    Given('the phone cannot reach the backend and 22 messages are on the anchor address', () => setUp(22));
    When('the first chain read has finished', () => advance(READ_MS, 100));
    Then('WhatsOnChain was asked for the hex of 10 transactions', () => {
      expect(hexCalls()).toBe(MAX_TXS_PER_READ);
    });
    And('10 messages are on the phone', async () => {
      expect(await messagesOnPhone()).toBe(MAX_TXS_PER_READ);
    });
    When('two more chain reads have finished', () => advance(2 * READ_MS, 100));
    Then('WhatsOnChain was asked for the hex of 22 transactions', () => {
      expect(hexCalls()).toBe(22);
    });
    And('22 messages are on the phone', async () => {
      expect(await messagesOnPhone()).toBe(22);
      stopLive();
    });
  });

  Scenario('mw-jrx0s.20 AC-3: a transaction whose hex fails loses nothing else, and is asked for again', ({ Given, When, Then, And }) => {
    Given('the phone cannot reach the backend and 3 messages are on the anchor address', () => setUp(3));
    And('WhatsOnChain fails to give the hex of the second', () => {
      chain.failHex.add(txids[1]);
    });
    When('the first chain read has finished', () => advance(CHAIN_POLL_MS + 2 * HEX_GAP_MS, 100));
    Then('2 messages are on the phone', async () => {
      expect(await messagesOnPhone()).toBe(2);
    });
    When("WhatsOnChain gives the hex again and the reader's backoff has passed", async () => {
      chain.failHex.clear();
      await advance(2 * CHAIN_POLL_MS + HEX_GAP_MS, 100);
    });
    Then('3 messages are on the phone', async () => {
      expect(await messagesOnPhone()).toBe(3);
      expect(hexCalls()).toBe(4); // three, and the failed one again
      stopLive();
    });
  });

  Scenario('mw-1ox07o.3 AC-1: empty reads back off 5, 10, 20, 40, 60, 60 s while the backend stays out of reach', ({ Given, When, Then }) => {
    Given('the phone cannot reach the backend and the anchor address has no messages', () => setUp(0));
    When('the phone has been out of reach for 74 seconds', () => advance(74_000));
    Then('WhatsOnChain was asked for the history 3 times', () => {
      // reads at 5 s, 15 s and 35 s; the next is due at 75 s
      expect(historyCalls()).toBe(3);
    });
    When('2 more seconds pass', () => advance(2_000));
    Then('WhatsOnChain was asked for the history 4 times', () => {
      expect(historyCalls()).toBe(4); // 75 s
    });
    When('120 more seconds pass', () => advance(120_000));
    Then('WhatsOnChain was asked for the history 6 times', () => {
      expect(historyCalls()).toBe(6); // 135 s and 195 s: 60 s apart
    });
    When('58 more seconds pass', () => advance(58_000));
    Then('WhatsOnChain had still been asked for the history 6 times', () => {
      expect(historyCalls()).toBe(6);
    });
    When('3 more seconds pass', () => advance(3_000));
    Then('WhatsOnChain was asked for the history 7 times', () => {
      expect(historyCalls()).toBe(7); // 255 s: the wait stays at 60 s
      stopLive();
    });
  });

  Scenario('mw-1ox07o.3 AC-2: a message found on the chain brings the wait back to 5 s', ({ Given, When, Then, And }) => {
    Given('the phone cannot reach the backend and the anchor address has no messages', () => setUp(0));
    When('the phone has been out of reach for 16 seconds', () => advance(16_000));
    Then('WhatsOnChain was asked for the history 2 times', () => {
      expect(historyCalls()).toBe(2); // 5 s and 15 s; the next is due at 35 s
    });
    When('a message lands on the anchor address and 20 more seconds pass', async () => {
      chain.txs.push(messageOnChain('hello'));
      await advance(20_000, 100);
    });
    Then('WhatsOnChain was asked for the history 3 times', () => {
      expect(historyCalls()).toBe(3); // the read at 35 s finds it
    });
    And('1 message is on the phone', async () => {
      expect(await messagesOnPhone()).toBe(1);
    });
    When('6 more seconds pass', () => advance(6_000, 100));
    Then('WhatsOnChain was asked for the history 4 times', () => {
      expect(historyCalls()).toBe(4); // 40 s: back to 5 s, not 75 s
      stopLive();
    });
  });

  Scenario('mw-1ox07o.3 AC-3: a hidden page makes no chain read, and reads again once it is visible', ({ Given, When, Then }) => {
    Given('the phone cannot reach the backend and the page is hidden', async () => {
      await setUp(0);
      pageHidden = true;
    });
    When('the phone has been out of reach for 200 seconds', () => advance(200_000));
    Then('WhatsOnChain was not asked for the history', () => {
      expect(historyCalls()).toBe(0);
    });
    When('the page becomes visible and 6 seconds pass', async () => {
      pageHidden = false;
      await advance(6_000);
    });
    Then('WhatsOnChain was asked for the history 1 time', () => {
      expect(historyCalls()).toBe(1);
      stopLive();
    });
  });
});
