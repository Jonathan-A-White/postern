// features/steps/question.steps.tsx — runs features/question.feature under
// vitest via @amiceli/vitest-cucumber, the same fetch-stub approach
// features/steps/messages.steps.tsx and features/steps/projects.steps.tsx use.
// A reply's broadcast is proven the way tests/unit/send.test.ts does: decode the
// record script off the raw signed tx and decrypt it with the Mayor's own key.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup } from '@testing-library/react';
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
import { encodeQuestion, type Snapshot } from '../../src/services/questions';
import { lock } from '../../src/services/keySession';

const MAYOR_KEY = PrivateKey.fromHex('77'.repeat(32));

const BEAD_ID = 'mw-epic.1';
const EPIC_ID = 'mw-epic';
const QUESTION_TEXT = 'Ship the walking skeleton now, or wait for WireGuard?';
const RECOMMENDED = 'ship';
const OPTIONS = ['ship', 'wait'];

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
  await db.answers.clear();
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

function decisionNeededRecord(bodyText: string, recipientPublicKeyHex: string, seq = 1): FixtureRecord {
  const payload = encryptMessage({
    text: bodyText,
    class: 'decision-needed',
    senderPrivateKeyHex: MAYOR_KEY.toHex(),
    recipientPublicKeyHex,
  });
  return { seq, txid: seq.toString(16).padStart(64, '0'), vout: 0, payload };
}

function encryptSnapshot(snapshot: Snapshot, recipientPublicKeyHex: string): string {
  const plaintextBytes = Utils.toArray(JSON.stringify(snapshot), 'utf8');
  const encrypted = EncryptedMessage.encrypt(plaintextBytes, MAYOR_KEY, PublicKey.fromString(recipientPublicKeyHex));
  return Utils.toBase64(encrypted);
}

function needsYouSnapshot(): Snapshot {
  return {
    written_at: new Date().toISOString(),
    epics: [
      {
        id: EPIC_ID,
        title: 'The epic',
        priority: 'P1',
        status: 'in-progress',
        needs_you: [
          { id: BEAD_ID, title: QUESTION_TEXT, asked_at: '2026-09-24T08:00:00Z', recommended: RECOMMENDED, options: OPTIONS },
        ],
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

function decodedReplyFromBroadcast(fetchMock: ReturnType<typeof installCombinedFetchMock>): unknown {
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
  // Waits for the unlock's async tail (setKey included) to fully settle before
  // the step returns — otherwise it can still be in flight when the next
  // scenario's freshScreen() calls lock(), leaking this key into it.
  await screen.findByRole('button', { name: 'Lock' });
}

function assertQuestionScreenVisible(): void {
  expect(screen.getAllByText(QUESTION_TEXT).length).toBeGreaterThan(0);
  expect(screen.getByText(`Recommended: ${RECOMMENDED}`)).toBeInTheDocument();
  for (const option of OPTIONS) {
    expect(screen.getByTestId(`option-${option}`)).toBeInTheDocument();
  }
  expect(screen.getByLabelText('Your own answer')).toBeInTheDocument();
}

const feature = await loadFeature('features/question.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario(
    'AC-1: a decision-needed message with a §6 body opens the Question screen',
    ({ Given, When, Then }) => {
      let mnemonic: string;

      Given('a decision-needed message carrying a §6 question is in the inbox', async () => {
        await freshScreen();
        const him = await saveVaultForHim();
        mnemonic = him.mnemonic;
        await setMayorPublicKey(MAYOR_KEY.toPublicKey().toString());
        const bodyText = encodeQuestion({ bead: BEAD_ID, q: QUESTION_TEXT, rec: RECOMMENDED, options: OPTIONS });
        vi.stubGlobal('fetch', installCombinedFetchMock({ messageRecords: [decisionNeededRecord(bodyText, him.publicKeyHex)] }));
      });

      When('the inbox is opened, unlocked and the question message is tapped', async () => {
        window.history.pushState({}, '', '?screen=inbox');
        render(<App />);
        await unlockScreen(mnemonic);
        const row = await screen.findByRole('button', { name: new RegExp(BEAD_ID.replace('.', '\\.')) });
        await userEvent.click(row);
      });

      Then(
        'the Question screen shows the question text, "Recommended: ship", a button for each option and a free-text box',
        async () => {
          await screen.findByTestId(`option-${OPTIONS[0]}`);
          assertQuestionScreenVisible();
        },
      );
    },
  );

  Scenario(
    'AC-2: tapping an option sends the reply, shows the txid and clears Needs you',
    ({ Given, And, When, Then }) => {
      let mnemonic: string;
      let hisPublicKeyHex: string;
      let fetchOptions: FetchMockOptions;
      let fetchMock: ReturnType<typeof installCombinedFetchMock>;

      Given('a decision-needed message carrying a §6 question is in the inbox', async () => {
        await freshScreen();
        const him = await saveVaultForHim();
        mnemonic = him.mnemonic;
        hisPublicKeyHex = him.publicKeyHex;
        await setMayorPublicKey(MAYOR_KEY.toPublicKey().toString());
        const bodyText = encodeQuestion({ bead: BEAD_ID, q: QUESTION_TEXT, rec: RECOMMENDED, options: OPTIONS });
        fetchOptions = { messageRecords: [decisionNeededRecord(bodyText, him.publicKeyHex)] };
        fetchMock = installCombinedFetchMock(fetchOptions);
        vi.stubGlobal('fetch', fetchMock);
      });

      And('the same bead is listed under Needs you in the snapshot', () => {
        fetchOptions.snapshotBase64 = encryptSnapshot(needsYouSnapshot(), hisPublicKeyHex);
      });

      And('the backend has spendable coins and accepts the broadcast', () => {
        fetchOptions.utxoSatoshis = 10_000;
      });

      And('the inbox is opened, unlocked and the question message is tapped', async () => {
        window.history.pushState({}, '', '?screen=inbox');
        render(<App />);
        await unlockScreen(mnemonic);
        const row = await screen.findByRole('button', { name: new RegExp(BEAD_ID.replace('.', '\\.')) });
        await userEvent.click(row);
        await screen.findByTestId(`option-${OPTIONS[0]}`);
      });

      When('the "wait" option is tapped', async () => {
        await userEvent.click(screen.getByTestId('option-wait'));
      });

      Then('the broadcast message decrypts to the reply {"bead":"mw-epic.1","answer":"wait"}', async () => {
        await screen.findByText(/^Sent\. Transaction id:/);
        expect(decodedReplyFromBroadcast(fetchMock)).toEqual({ bead: BEAD_ID, answer: 'wait' });
      });

      And('the transaction id is shown', () => {
        expect(screen.getByText(/^Sent\. Transaction id:/)).toBeInTheDocument();
      });

      And('the Project screen no longer lists that bead under Needs you', async () => {
        cleanup();
        window.history.pushState({}, '', `?screen=project&epic=${EPIC_ID}`);
        render(<App />);
        // mw-tfne4.23: the key unlocked on the inbox carries over, no second prompt.
        await screen.findByText('The epic');
        expect(screen.queryByTestId('needs-you-row')).not.toBeInTheDocument();
        expect(screen.getByText('Nothing needs you.')).toBeInTheDocument();
      });
    },
  );

  Scenario('AC-3: sending free text sends the reply and clears Needs you', ({ Given, And, When, Then }) => {
    let mnemonic: string;
    let hisPublicKeyHex: string;
    let fetchOptions: FetchMockOptions;
    let fetchMock: ReturnType<typeof installCombinedFetchMock>;

    Given('a decision-needed message carrying a §6 question is in the inbox', async () => {
      await freshScreen();
      const him = await saveVaultForHim();
      mnemonic = him.mnemonic;
      hisPublicKeyHex = him.publicKeyHex;
      await setMayorPublicKey(MAYOR_KEY.toPublicKey().toString());
      const bodyText = encodeQuestion({ bead: BEAD_ID, q: QUESTION_TEXT, rec: RECOMMENDED, options: OPTIONS });
      fetchOptions = { messageRecords: [decisionNeededRecord(bodyText, him.publicKeyHex)] };
      fetchMock = installCombinedFetchMock(fetchOptions);
      vi.stubGlobal('fetch', fetchMock);
    });

    And('the same bead is listed under Needs you in the snapshot', () => {
      fetchOptions.snapshotBase64 = encryptSnapshot(needsYouSnapshot(), hisPublicKeyHex);
    });

    And('the backend has spendable coins and accepts the broadcast', () => {
      fetchOptions.utxoSatoshis = 10_000;
    });

    And('the inbox is opened, unlocked and the question message is tapped', async () => {
      window.history.pushState({}, '', '?screen=inbox');
      render(<App />);
      await unlockScreen(mnemonic);
      const row = await screen.findByRole('button', { name: new RegExp(BEAD_ID.replace('.', '\\.')) });
      await userEvent.click(row);
      await screen.findByLabelText('Your own answer');
    });

    When('free text "let\'s ship at 5pm" is typed and sent', async () => {
      await userEvent.type(screen.getByLabelText('Your own answer'), "let's ship at 5pm");
      await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    Then(
      'the broadcast message decrypts to the reply {"bead":"mw-epic.1","answer":"let\'s ship at 5pm"}',
      async () => {
        await screen.findByText(/^Sent\. Transaction id:/);
        expect(decodedReplyFromBroadcast(fetchMock)).toEqual({ bead: BEAD_ID, answer: "let's ship at 5pm" });
      },
    );

    And('the Project screen no longer lists that bead under Needs you', async () => {
      cleanup();
      window.history.pushState({}, '', `?screen=project&epic=${EPIC_ID}`);
      render(<App />);
      // mw-tfne4.23: the key unlocked on the inbox carries over, no second prompt.
      await screen.findByText('The epic');
      expect(screen.queryByTestId('needs-you-row')).not.toBeInTheDocument();
      expect(screen.getByText('Nothing needs you.')).toBeInTheDocument();
    });
  });

  Scenario('AC-4: a plain decision-needed text with no §6 body shows as an ordinary message', ({ Given, When, Then, And }) => {
    let mnemonic: string;
    const plainText = 'The gate is open, ready when you are.';

    Given('a decision-needed message with plain text is in the inbox', async () => {
      await freshScreen();
      const him = await saveVaultForHim();
      mnemonic = him.mnemonic;
      vi.stubGlobal('fetch', installCombinedFetchMock({ messageRecords: [decisionNeededRecord(plainText, him.publicKeyHex)] }));
    });

    When('the inbox is opened and unlocked', async () => {
      window.history.pushState({}, '', '?screen=inbox');
      render(<App />);
      await unlockScreen(mnemonic);
    });

    Then('the message is shown as an ordinary message', async () => {
      expect(await screen.findByText(plainText)).toBeInTheDocument();
    });

    And('tapping it does not open the Question screen', async () => {
      await userEvent.click(screen.getByRole('button', { name: new RegExp('The gate is open') }));
      expect(screen.queryByLabelText('Your own answer')).not.toBeInTheDocument();
      expect(screen.getByText(plainText)).toBeInTheDocument();
    });
  });

  Scenario('AC-5: tapping a Needs you row opens the same Question screen', ({ Given, And, When, Then }) => {
    let mnemonic: string;

    Given('the same bead is listed under Needs you in the snapshot with no matching message synced', async () => {
      await freshScreen();
      const him = await saveVaultForHim();
      mnemonic = him.mnemonic;
      await setMayorPublicKey(MAYOR_KEY.toPublicKey().toString());
      vi.stubGlobal('fetch', installCombinedFetchMock({ snapshotBase64: encryptSnapshot(needsYouSnapshot(), him.publicKeyHex) }));
    });

    And('the Project screen is opened and unlocked', async () => {
      window.history.pushState({}, '', `?screen=project&epic=${EPIC_ID}`);
      render(<App />);
      await unlockScreen(mnemonic);
      await screen.findByText(QUESTION_TEXT);
    });

    When('the Needs you row is tapped', async () => {
      const link = screen.getByRole('link', { name: new RegExp(QUESTION_TEXT.slice(0, 10)) });
      const href = link.getAttribute('href');
      if (!href) throw new Error('the row has no href');
      cleanup();
      window.history.pushState({}, '', href);
      render(<App />);
      // mw-tfne4.23: the key unlocked on the Project screen carries over, so the
      // bead screen needs no second fingerprint/phrase prompt within the session.
    });

    Then(
      'the Question screen shows the question text, "Recommended: ship", a button for each option and a free-text box',
      async () => {
        await screen.findByTestId(`option-${OPTIONS[0]}`);
        assertQuestionScreenVisible();
      },
    );
  });
});

afterAll(() => {
  cleanup();
  vi.unstubAllGlobals();
});
