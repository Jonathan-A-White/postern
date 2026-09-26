// features/steps/threads.steps.tsx — runs features/threads.feature under
// vitest via @amiceli/vitest-cucumber, the same combined fetch-stub approach
// features/steps/question.steps.tsx uses (messages + snapshot + utxos +
// broadcast behind one fetch double), and the same pushState-then-render<App/>
// navigation features/steps/projects.steps.tsx uses instead of a real jsdom
// link click.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, PublicKey, Transaction, Utils } from '@bsv/sdk';
import { EncryptedMessage, decodeRecordScript } from 'spell-forge-bsv';
import { App } from '../../src/App';
import { db } from '../../src/data/db';
import { vaultRepo } from '../../src/data/repositories';
import {
  createMnemonic,
  deriveAesKeyFromPhrase,
  deriveMasterKey,
  publicKeyHexFromMasterKey,
  wrapKey,
} from '../../src/services/vault';
import { decryptMessage, encryptMessage, setMayorPublicKey, type MessagePayload } from '../../src/services/messages';
import { encodeThreadedMessage, type ThreadRef } from '../../src/services/threads';
import type { Snapshot } from '../../src/services/questions';
import { lock } from '../../src/services/keySession';

const MAYOR_KEY = PrivateKey.fromHex('88'.repeat(32));
const BEAD_ID = 'mw-threads.1';
const BEAD_TITLE = 'Ship the walking skeleton';

interface FixtureRecord {
  seq: number;
  txid: string;
  vout: number;
  payload: unknown;
}

interface FetchMockOptions {
  messageRecords?: FixtureRecord[];
  snapshotBase64?: string;
  utxoSatoshis?: number;
}

async function freshScreen(): Promise<void> {
  cleanup();
  await db.vault.clear();
  await db.settings.clear();
  await db.messages.clear();
  await db.snapshot.clear();
  lock();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
}

async function saveVaultForHim(): Promise<{ mnemonic: string; publicKeyHex: string }> {
  const mnemonic = createMnemonic();
  const key = await deriveMasterKey(mnemonic);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await deriveAesKeyFromPhrase(mnemonic, salt);
  const wrapped = await wrapKey(key, aesKey);
  const publicKeyHex = publicKeyHexFromMasterKey(key);
  await vaultRepo.save({
    mode: 'phrase',
    ciphertext: wrapped.ciphertext,
    iv: wrapped.iv,
    salt,
    prfFallbackReason: 'webauthn-unavailable',
    publicKeyHex,
  });
  return { mnemonic, publicKeyHex };
}

let seqCounter = 0;

function threadedMessageRecord(
  text: string,
  thread: ThreadRef | undefined,
  ts: number,
  recipientPublicKeyHex: string,
): FixtureRecord {
  seqCounter += 1;
  const payload = encryptMessage({
    text: encodeThreadedMessage({ thread, text }),
    class: 'message',
    senderPrivateKeyHex: MAYOR_KEY.toHex(),
    recipientPublicKeyHex,
    ts,
  });
  return { seq: seqCounter, txid: seqCounter.toString(16).padStart(64, '0'), vout: 0, payload };
}

function encryptSnapshot(snapshot: Snapshot, recipientPublicKeyHex: string): string {
  const plaintextBytes = Utils.toArray(JSON.stringify(snapshot), 'utf8');
  const encrypted = EncryptedMessage.encrypt(plaintextBytes, MAYOR_KEY, PublicKey.fromString(recipientPublicKeyHex));
  return Utils.toBase64(encrypted);
}

function beadTitleSnapshot(): Snapshot {
  return {
    written_at: new Date().toISOString(),
    epics: [
      {
        id: 'mw-threads',
        title: 'The threads epic',
        priority: 'P1',
        status: 'in-progress',
        needs_you: [{ id: BEAD_ID, title: BEAD_TITLE, asked_at: '2026-09-24T08:00:00Z', recommended: 'ship', options: ['ship'] }],
        landed: [],
        working: [],
        closed_count: 0,
      },
    ],
  };
}

function installCombinedFetchMock(options: FetchMockOptions) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(input);
    if (urlStr.includes('/messages')) {
      const url = new URL(urlStr, 'http://localhost');
      const since = Number(url.searchParams.get('since') ?? '0');
      const records = (options.messageRecords ?? []).filter((record) => record.seq > since);
      const seqs = (options.messageRecords ?? []).map((record) => record.seq);
      const next = seqs.length > 0 ? Math.max(...seqs) : since;
      return new Response(JSON.stringify({ records, next }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (urlStr.endsWith('/snapshot')) {
      if (!options.snapshotBase64) throw new Error(`unexpected fetch: ${urlStr}`);
      return new Response(options.snapshotBase64, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    if (urlStr.includes('/utxos/')) {
      return new Response(
        JSON.stringify({ utxos: [{ txid: 'a'.repeat(64), vout: 0, satoshis: options.utxoSatoshis ?? 10_000, height: 100 }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (urlStr.endsWith('/broadcast')) {
      const body = JSON.parse(String(init?.body)) as { rawtx: string };
      const tx = Transaction.fromHex(body.rawtx);
      return new Response(JSON.stringify({ txid: tx.id('hex') }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch: ${urlStr}`);
  });
}

function decodedThreadedTextFromBroadcast(fetchMock: ReturnType<typeof installCombinedFetchMock>): unknown {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/broadcast'));
  if (!call) throw new Error('no /broadcast call was made');
  const init = call[1] as RequestInit;
  const body = JSON.parse(String(init.body)) as { rawtx: string };
  const tx = Transaction.fromHex(body.rawtx);
  const decoded = decodeRecordScript(tx.outputs[0].lockingScript);
  if (!decoded) throw new Error('no record script found in the broadcast tx');
  const payload = JSON.parse(Utils.toUTF8(decoded.payloadBytes)) as MessagePayload;
  return JSON.parse(decryptMessage(payload, MAYOR_KEY.toHex()));
}

async function unlockScreen(mnemonic: string): Promise<void> {
  await userEvent.type(await screen.findByLabelText('Recovery phrase'), mnemonic);
  await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  await screen.findByRole('button', { name: 'Lock' });
}

async function openThreadRow(name: RegExp): Promise<void> {
  const link = await screen.findByRole('link', { name });
  const href = link.getAttribute('href');
  if (!href) throw new Error('the thread row has no href');
  cleanup();
  window.history.pushState({}, '', href);
  render(<App />);
}

const feature = await loadFeature('features/threads.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario(
    "AC-1: threads are listed by newest activity, a bead thread titled from the snapshot, topics by name, the general thread last, each with its unread count",
    ({ Given, And, When, Then }) => {
      let mnemonic: string;
      let hisPublicKeyHex: string;
      let fetchOptions: FetchMockOptions;

      Given(
        'a bead thread, a topic thread and the general thread each have one unread message, the topic the newest, then the general thread, then the bead thread the oldest',
        async () => {
          await freshScreen();
          const him = await saveVaultForHim();
          mnemonic = him.mnemonic;
          hisPublicKeyHex = him.publicKeyHex;
          fetchOptions = {
            messageRecords: [
              threadedMessageRecord('meet at the usual place', { bead: BEAD_ID }, 100, hisPublicKeyHex),
              threadedMessageRecord('the general update', undefined, 150, hisPublicKeyHex),
              threadedMessageRecord('ready when you are', { topic: 'launch plan' }, 200, hisPublicKeyHex),
            ],
          };
          vi.stubGlobal('fetch', installCombinedFetchMock(fetchOptions));
        },
      );

      And("the snapshot names the bead thread's title", () => {
        fetchOptions.snapshotBase64 = encryptSnapshot(beadTitleSnapshot(), hisPublicKeyHex);
      });

      When('the Threads screen is opened and unlocked', async () => {
        window.history.pushState({}, '', '?screen=threads');
        render(<App />);
        await unlockScreen(mnemonic);
      });

      Then(
        'the threads are listed in the order: the topic thread, the bead thread titled from the snapshot, then the general thread last',
        async () => {
          const rows = await screen.findAllByTestId('thread-row');
          expect(rows).toHaveLength(3);
          expect(within(rows[0]).getByText('launch plan')).toBeInTheDocument();
          expect(within(rows[1]).getByText(BEAD_TITLE)).toBeInTheDocument();
          expect(within(rows[2]).getByText('General')).toBeInTheDocument();
        },
      );

      And('each thread\'s row shows "1 unread"', async () => {
        const rows = await screen.findAllByTestId('thread-row');
        for (const row of rows) {
          expect(within(row).getByText('1 unread')).toBeInTheDocument();
        }
      });
    },
  );

  Scenario("AC-2: opening a thread shows its messages in order", ({ Given, When, Then }) => {
    let mnemonic: string;

    Given('a bead thread has two messages sent out of chronological order', async () => {
      await freshScreen();
      const him = await saveVaultForHim();
      mnemonic = him.mnemonic;
      vi.stubGlobal(
        'fetch',
        installCombinedFetchMock({
          messageRecords: [
            threadedMessageRecord('the second thing said', { bead: BEAD_ID }, 300, him.publicKeyHex),
            threadedMessageRecord('the first thing said', { bead: BEAD_ID }, 100, him.publicKeyHex),
          ],
        }),
      );
    });

    When("the Threads screen is opened, unlocked and that thread's row is opened", async () => {
      window.history.pushState({}, '', '?screen=threads');
      render(<App />);
      await unlockScreen(mnemonic);
      await openThreadRow(new RegExp(BEAD_ID.replace('.', '\\.')));
    });

    Then("the thread's messages are shown oldest first", async () => {
      const rows = await screen.findAllByTestId('thread-message');
      expect(rows.map((row) => row.textContent)).toEqual(['the first thing said', 'the second thing said']);
    });
  });

  Scenario('AC-3: a reply sent from an open thread carries the same thread', ({ Given, And, When, Then }) => {
    let mnemonic: string;
    let fetchOptions: FetchMockOptions;
    let fetchMock: ReturnType<typeof installCombinedFetchMock>;

    Given('a bead thread already has one message', async () => {
      await freshScreen();
      const him = await saveVaultForHim();
      mnemonic = him.mnemonic;
      await setMayorPublicKey(MAYOR_KEY.toPublicKey().toString());
      fetchOptions = { messageRecords: [threadedMessageRecord('meet at the usual place', { bead: BEAD_ID }, 100, him.publicKeyHex)] };
      fetchMock = installCombinedFetchMock(fetchOptions);
      vi.stubGlobal('fetch', fetchMock);
    });

    And("the Threads screen is opened, unlocked and that thread's row is opened", async () => {
      window.history.pushState({}, '', '?screen=threads');
      render(<App />);
      await unlockScreen(mnemonic);
      await openThreadRow(new RegExp(BEAD_ID.replace('.', '\\.')));
      await screen.findByText('meet at the usual place');
    });

    And('the backend has spendable coins and accepts the broadcast', () => {
      fetchOptions.utxoSatoshis = 10_000;
    });

    When('a reply is typed and sent', async () => {
      await userEvent.type(screen.getByLabelText('Reply'), 'on my way now');
      await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    Then('the broadcast message decrypts to a reply naming the same bead thread', async () => {
      await screen.findByText(/^Sent\. Transaction id:/);
      expect(decodedThreadedTextFromBroadcast(fetchMock)).toEqual({ thread: { bead: BEAD_ID }, text: 'on my way now' });
    });
  });

  Scenario('AC-4: a New topic control opens a named thread', ({ Given, When, Then }) => {
    Given('the Threads screen is opened and unlocked', async () => {
      await freshScreen();
      const him = await saveVaultForHim();
      await setMayorPublicKey(MAYOR_KEY.toPublicKey().toString());
      vi.stubGlobal('fetch', installCombinedFetchMock({ messageRecords: [] }));
      window.history.pushState({}, '', '?screen=threads');
      render(<App />);
      await unlockScreen(him.mnemonic);
    });

    When('"New topic" is used to open a topic named "launch plan"', async () => {
      await userEvent.type(screen.getByLabelText('New topic'), 'launch plan');
      const link = screen.getByRole('link', { name: 'Open topic' });
      const href = link.getAttribute('href');
      if (!href) throw new Error('the Open topic link has no href');
      cleanup();
      window.history.pushState({}, '', href);
      render(<App />);
    });

    Then('the thread screen for "launch plan" is shown, with no messages yet and a reply box', async () => {
      expect(await screen.findByRole('heading', { name: 'launch plan' })).toBeInTheDocument();
      expect(await screen.findByText('No messages yet.')).toBeInTheDocument();
      expect(screen.queryByTestId('thread-message')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Reply')).toBeInTheDocument();
    });
  });
});

afterAll(() => {
  cleanup();
  vi.unstubAllGlobals();
});
