// features/steps/inbox-links.steps.tsx — runs features/inbox-links.feature under
// vitest via @amiceli/vitest-cucumber, the same combined fetch-stub approach and
// pushState-then-render<App/> navigation features/steps/threads.steps.tsx uses,
// starting from the Inbox screen instead of the Threads screen.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, Transaction, Utils } from '@bsv/sdk';
import { decodeRecordScript } from 'spell-forge-bsv';
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
import { lock } from '../../src/services/keySession';

const MAYOR_KEY = PrivateKey.fromHex('aa'.repeat(32));
const BEAD_ID = 'mw-inbox-links.1';

interface FixtureRecord {
  seq: number;
  txid: string;
  vout: number;
  payload: unknown;
}

interface FetchMockOptions {
  messageRecords?: FixtureRecord[];
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

function installCombinedFetchMock(options: FetchMockOptions) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(input);
    if (urlStr.endsWith('/challenge')) {
      return new Response(JSON.stringify({ nonce: 'a'.repeat(64) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
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

async function openInboxRow(name: RegExp): Promise<void> {
  const link = await screen.findByRole('link', { name });
  const href = link.getAttribute('href');
  if (!href) throw new Error('the inbox row has no href');
  cleanup();
  window.history.pushState({}, '', href);
  render(<App />);
}

const feature = await loadFeature('features/inbox-links.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('AC-3: tapping an inbox message opens its thread where he can reply', ({ Given, And, When, Then }) => {
    let mnemonic: string;
    let fetchOptions: FetchMockOptions;
    let fetchMock: ReturnType<typeof installCombinedFetchMock>;

    Given('a message with a bead thread is in the inbox', async () => {
      await freshScreen();
      const him = await saveVaultForHim();
      mnemonic = him.mnemonic;
      await setMayorPublicKey(MAYOR_KEY.toPublicKey().toString());
      fetchOptions = { messageRecords: [threadedMessageRecord('meet at the usual place', { bead: BEAD_ID }, 100, him.publicKeyHex)] };
      fetchMock = installCombinedFetchMock(fetchOptions);
      vi.stubGlobal('fetch', fetchMock);
    });

    And('the backend has spendable coins and accepts the broadcast', () => {
      fetchOptions.utxoSatoshis = 10_000;
    });

    When('the inbox is opened, unlocked, the message is tapped, and a reply is typed and sent', async () => {
      window.history.pushState({}, '', '?screen=inbox');
      render(<App />);
      await unlockScreen(mnemonic);
      await openInboxRow(/meet at the usual place/);
      await screen.findByText('meet at the usual place');
      await userEvent.type(screen.getByLabelText('Reply'), 'on my way now');
      await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    Then('the message is shown in its thread', () => {
      expect(screen.getByText('meet at the usual place')).toBeInTheDocument();
    });

    And('the broadcast message decrypts to a reply naming the same bead thread', async () => {
      await screen.findByText(/^Sent\. Transaction id:/);
      expect(decodedThreadedTextFromBroadcast(fetchMock)).toEqual({ thread: { bead: BEAD_ID }, text: 'on my way now' });
    });
  });
});

afterAll(() => {
  cleanup();
  vi.unstubAllGlobals();
});
