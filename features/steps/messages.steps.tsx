// features/steps/messages.steps.tsx — runs features/messages.feature under vitest
// via @amiceli/vitest-cucumber. AC-1/AC-2 exercise src/services/messages.ts directly
// (the envelope logic); AC-3/AC-4 render the Compose screen with global fetch
// stubbed, the same fetch-stub approach the story calls for instead of msw, since
// this rig has no msw dependency.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, Utils } from '@bsv/sdk';
import { Compose } from '../../src/compose';
import { Inbox } from '../../src/inbox';
import { db } from '../../src/data/db';
import { vaultRepo, messagesRepo } from '../../src/data/repositories';
import {
  createMnemonic,
  deriveAesKeyFromPhrase,
  deriveMasterKey,
  publicKeyHexFromMasterKey,
  wrapKey,
} from '../../src/services/vault';
import { decryptMessage, encryptMessage, setMayorPublicKey, type MessageClass, type MessagePayload } from '../../src/services/messages';
import * as inboxService from '../../src/services/inbox';
import { installMockAuthenticator, removeMockAuthenticator } from '../../tests/support/webauthn-mock';
import { lock } from '../../src/services/keySession';
import { encodeQuestion } from '../../src/services/questions';
import { encodeThreadedMessage } from '../../src/services/threads';

const MAYOR_KEY = PrivateKey.fromHex('11'.repeat(32));
const SENDER_KEY = PrivateKey.fromHex('22'.repeat(32));
const EAVESDROPPER_KEY = PrivateKey.fromHex('33'.repeat(32));

// unlockInbox() only waits for the Lock button to paint, which happens before
// handleUnlockWithPhrase's tail (await initialSync -> decryptPendingMessages ->
// refreshMessages) resolves. cleanup() unmounts the component but cannot cancel
// that tail, so a slow one can still be running when the next scenario's
// freshCompose() clears and repopulates the tables it reads from — decrypting
// the new scenario's row with the old key and marking it unreadable for good,
// since decryptFailed is sticky (mw-tfne4.26). Spying on decryptPendingMessages
// lets freshCompose() drain any such call before clearing the tables.
const decryptPendingMessagesSpy = vi.spyOn(inboxService, 'decryptPendingMessages');

async function freshCompose(): Promise<void> {
  cleanup();
  removeMockAuthenticator();
  await Promise.allSettled(decryptPendingMessagesSpy.mock.results.map((result) => (result.type === 'return' ? result.value : Promise.resolve())));
  decryptPendingMessagesSpy.mockClear();
  await db.vault.clear();
  await db.settings.clear();
  await db.messages.clear();
  lock();
  vi.unstubAllGlobals();
}

/** Saves a PRF-mode vault whose fingerprint prompt is mocked to reject with a
 * dismissed/timed-out NotAllowedError: the unwrap never runs, so the wrapped
 * key material itself doesn't need to be genuine. */
async function savePrfVaultWithDismissedPrompt(): Promise<void> {
  installMockAuthenticator({ prfSupported: true, prfGetResult: 'not-allowed' });
  const key = await deriveMasterKey(createMnemonic());
  await vaultRepo.save({
    mode: 'prf',
    ciphertext: new ArrayBuffer(16),
    iv: new Uint8Array(12),
    credentialId: crypto.getRandomValues(new Uint8Array(16)).buffer,
    publicKeyHex: publicKeyHexFromMasterKey(key),
  });
}

interface FixtureRecord {
  seq: number;
  txid: string;
  vout: number;
  payload: unknown;
}

/** A GET /api/messages?since=<n> (docs/api.md) double: returns only fixture
 * records with seq greater than the requested `since`, and a `next` that names
 * the latest seq known — the same cursor contract the real backend keeps. */
function messagesFetchMock(records: FixtureRecord[]) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (!url.pathname.endsWith('/messages')) throw new Error(`unexpected fetch: ${url}`);
    const since = Number(url.searchParams.get('since') ?? '0');
    const matching = records.filter((record) => record.seq > since);
    const seqs = records.map((record) => record.seq);
    const next = seqs.length > 0 ? Math.max(...seqs) : since;
    return new Response(JSON.stringify({ records: matching, next }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

/** Saves a real phrase-wrapped vault for "him" and returns its mnemonic and
 * public key, so a fixture message can be addressed to it. */
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

/** His own private key, hex, from the mnemonic saveVaultForHim generated — needed
 * to build a fixture message encrypted as if sent from his own phone. */
async function privateKeyHexFromMnemonic(mnemonic: string): Promise<string> {
  const key = await deriveMasterKey(mnemonic);
  return Utils.toHex(Array.from(key));
}

async function unlockInbox(mnemonic: string): Promise<void> {
  await userEvent.type(await screen.findByLabelText('Recovery phrase'), mnemonic);
  await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  // The Lock button paints as soon as setKey/setScreen run, which is before
  // the rest of the unlock handler's tail (decryptPendingMessages, then
  // refreshMessages) resolves — freshCompose() is what actually waits out
  // that tail before the next scenario touches the tables (mw-tfne4.26).
  await screen.findByRole('button', { name: 'Lock' });
}

/** Saves a real phrase-wrapped vault (genuine wrapping, unlockable through the UI
 * with the returned mnemonic) and sets the Mayor's public key as the recipient. */
async function openComposeUnlockedWithRecipient(): Promise<void> {
  const mnemonic = createMnemonic();
  const key = await deriveMasterKey(mnemonic);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await deriveAesKeyFromPhrase(mnemonic, salt);
  const wrapped = await wrapKey(key, aesKey);
  await vaultRepo.save({
    mode: 'phrase',
    ciphertext: wrapped.ciphertext,
    iv: wrapped.iv,
    salt,
    prfFallbackReason: 'webauthn-unavailable',
    publicKeyHex: publicKeyHexFromMasterKey(key),
  });
  await setMayorPublicKey(MAYOR_KEY.toPublicKey().toString());

  render(<Compose />);
  await userEvent.type(await screen.findByLabelText('Recovery phrase'), mnemonic);
  await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  await screen.findByLabelText('Message');
}

const feature = await loadFeature('features/messages.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario("AC-1: a text is encrypted so only the recipient key decrypts it", ({ Given, Then, And }) => {
    let payload: MessagePayload;

    Given("a message is encrypted for the Mayor's public key", async () => {
      await freshCompose();
      payload = encryptMessage({
        text: 'the gate is open',
        class: 'message',
        senderPrivateKeyHex: SENDER_KEY.toHex(),
        recipientPublicKeyHex: MAYOR_KEY.toPublicKey().toString(),
      });
    });

    Then("the Mayor's private key decrypts it to the original text", () => {
      expect(decryptMessage(payload, MAYOR_KEY.toHex())).toBe('the gate is open');
    });

    And('a different private key fails to decrypt it', () => {
      expect(() => decryptMessage(payload, EAVESDROPPER_KEY.toHex())).toThrow();
    });
  });

  Scenario('AC-2: the class tag is readable without the key', ({ Given, Then }) => {
    let payload: MessagePayload;

    Given('a message of class "alarm" is encrypted for the Mayor\'s public key', async () => {
      await freshCompose();
      payload = encryptMessage({
        text: 'evacuate the north tower',
        class: 'alarm' as MessageClass,
        senderPrivateKeyHex: SENDER_KEY.toHex(),
        recipientPublicKeyHex: MAYOR_KEY.toPublicKey().toString(),
      });
    });

    Then('the class tag "alarm" is readable from the payload without decrypting it', () => {
      // Simulates a chain reader with no private key: parse the JSON straight off
      // the wire and read `class` without ever calling decryptMessage.
      const wireForm = JSON.parse(JSON.stringify(payload)) as MessagePayload;
      expect(wireForm.class).toBe('alarm');
      expect(wireForm.ct).not.toContain('evacuate');
    });
  });

  Scenario('AC-3: a successful send shows the txid', ({ Given, And, When, Then }) => {
    Given('the compose screen is opened with an unlocked key and a recipient set', async () => {
      await freshCompose();
      await openComposeUnlockedWithRecipient();
    });

    And('the backend has spendable coins and accepts the broadcast', () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes('/utxos/')) {
            return new Response(
              JSON.stringify({ utxos: [{ txid: 'a'.repeat(64), vout: 0, satoshis: 10_000, height: 100 }] }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          if (url.endsWith('/broadcast')) {
            return new Response(JSON.stringify({ txid: 'b'.repeat(64) }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          throw new Error(`unexpected fetch: ${url}`);
        }),
      );
    });

    When('a message is typed and sent', async () => {
      await userEvent.type(screen.getByLabelText('Message'), 'meet at the usual place');
      await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    Then('the compose screen shows the transaction id', async () => {
      expect(await screen.findByText(`Sent. Transaction id: ${'b'.repeat(64)}`)).toBeInTheDocument();
    });
  });

  Scenario('AC-4: an API error is shown and nothing is marked sent', ({ Given, And, When, Then }) => {
    Given('the compose screen is opened with an unlocked key and a recipient set', async () => {
      await freshCompose();
      await openComposeUnlockedWithRecipient();
    });

    And('the backend refuses to broadcast the transaction', () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes('/utxos/')) {
            return new Response(
              JSON.stringify({ utxos: [{ txid: 'a'.repeat(64), vout: 0, satoshis: 10_000, height: 100 }] }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          if (url.endsWith('/broadcast')) {
            return new Response(
              JSON.stringify({ error: 'WhatsOnChain said 400: tx rejected: bad-txns-inputs-missingorspent' }),
              { status: 502, headers: { 'Content-Type': 'application/json' } },
            );
          }
          throw new Error(`unexpected fetch: ${url}`);
        }),
      );
    });

    When('a message is typed and sent', async () => {
      await userEvent.type(screen.getByLabelText('Message'), 'meet at the usual place');
      await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    Then("the compose screen shows the backend's error", async () => {
      expect(
        await screen.findByText('WhatsOnChain said 400: tx rejected: bad-txns-inputs-missingorspent'),
      ).toBeInTheDocument();
    });

    And('the compose screen does not show a transaction id', () => {
      expect(screen.queryByText(/^Sent\. Transaction id:/)).not.toBeInTheDocument();
    });
  });

  Scenario('AC-5: a record addressed to him is shown decrypted', ({ Given, When, Then }) => {
    let mnemonic: string;

    Given('the backend has one message record addressed to him', async () => {
      await freshCompose();
      const him = await saveVaultForHim();
      mnemonic = him.mnemonic;
      const payload = encryptMessage({
        text: 'meet at the usual place',
        class: 'message',
        senderPrivateKeyHex: SENDER_KEY.toHex(),
        recipientPublicKeyHex: him.publicKeyHex,
      });
      vi.stubGlobal('fetch', messagesFetchMock([{ seq: 1, txid: 'a'.repeat(64), vout: 0, payload }]));
    });

    When('the inbox is opened and unlocked', async () => {
      render(<Inbox />);
      await unlockInbox(mnemonic);
    });

    Then('the message is shown decrypted in the inbox', async () => {
      expect(await screen.findByText('meet at the usual place')).toBeInTheDocument();
    });
  });

  Scenario('AC-6: a record addressed to someone else is not shown', ({ Given, When, Then }) => {
    let mnemonic: string;

    Given('the backend has one message record addressed to someone else', async () => {
      await freshCompose();
      const him = await saveVaultForHim();
      mnemonic = him.mnemonic;
      const payload = encryptMessage({
        text: 'not for him',
        class: 'message',
        senderPrivateKeyHex: SENDER_KEY.toHex(),
        recipientPublicKeyHex: EAVESDROPPER_KEY.toPublicKey().toString(),
      });
      vi.stubGlobal('fetch', messagesFetchMock([{ seq: 1, txid: 'a'.repeat(64), vout: 0, payload }]));
    });

    When('the inbox is opened and unlocked', async () => {
      render(<Inbox />);
      await unlockInbox(mnemonic);
    });

    Then('no message is shown in the inbox', async () => {
      expect(await screen.findByText('No messages yet.')).toBeInTheDocument();
      expect(screen.queryByText('not for him')).not.toBeInTheDocument();
    });
  });

  Scenario('AC-7: the cursor advances so a second sync fetches nothing new', ({ Given, And, When, Then }) => {
    let mnemonic: string;
    let fetchMock: ReturnType<typeof messagesFetchMock>;

    Given('the backend has one message record addressed to him', async () => {
      await freshCompose();
      const him = await saveVaultForHim();
      mnemonic = him.mnemonic;
      const payload = encryptMessage({
        text: 'first sync catch',
        class: 'message',
        senderPrivateKeyHex: SENDER_KEY.toHex(),
        recipientPublicKeyHex: him.publicKeyHex,
      });
      fetchMock = messagesFetchMock([{ seq: 7, txid: 'a'.repeat(64), vout: 0, payload }]);
      vi.stubGlobal('fetch', fetchMock);
    });

    And('the inbox has already synced once', async () => {
      render(<Inbox />);
      await unlockInbox(mnemonic);
      await screen.findByText('first sync catch');
    });

    When('the inbox is opened again', async () => {
      cleanup();
      render(<Inbox />);
      await screen.findByText('first sync catch');
    });

    Then("the second sync asks the backend for records since the first sync's cursor", () => {
      const calls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(calls[0]).toBe('/api/messages?since=0');
      expect(calls[1]).toBe('/api/messages?since=7');
    });

    And('the message is still shown only once', () => {
      expect(screen.getAllByText('first sync catch')).toHaveLength(1);
    });
  });

  Scenario('AC-8: offline shows the stored messages', ({ Given, When, Then }) => {
    Given('the inbox has already synced and decrypted one message', async () => {
      await freshCompose();
      const him = await saveVaultForHim();
      const payload = encryptMessage({
        text: 'stored while online',
        class: 'message',
        senderPrivateKeyHex: SENDER_KEY.toHex(),
        recipientPublicKeyHex: him.publicKeyHex,
      });
      vi.stubGlobal('fetch', messagesFetchMock([{ seq: 1, txid: 'a'.repeat(64), vout: 0, payload }]));

      render(<Inbox />);
      await unlockInbox(him.mnemonic);
      await screen.findByText('stored while online');
    });

    When('the inbox is opened while the backend is unreachable', async () => {
      cleanup();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('the network is unreachable');
        }),
      );
      render(<Inbox />);
    });

    Then('the previously stored message is still shown in the inbox', async () => {
      expect(await screen.findByText('stored while online')).toBeInTheDocument();
    });
  });

  Scenario(
    'AC-9: a record that fails to decrypt is shown as unreadable, not dropped',
    ({ Given, When, Then }) => {
      let mnemonic: string;

      Given('the backend has one message record addressed to him that his key cannot decrypt', async () => {
        await freshCompose();
        const him = await saveVaultForHim();
        mnemonic = him.mnemonic;

        // Encrypted for the eavesdropper, not him, then its `to` field is forged
        // to name his public key — his real key cannot decrypt this ciphertext.
        const payload = encryptMessage({
          text: 'not really for him',
          class: 'message',
          senderPrivateKeyHex: SENDER_KEY.toHex(),
          recipientPublicKeyHex: EAVESDROPPER_KEY.toPublicKey().toString(),
        });
        const forged = { ...payload, to: him.publicKeyHex };
        vi.stubGlobal('fetch', messagesFetchMock([{ seq: 1, txid: 'a'.repeat(64), vout: 0, payload: forged }]));
      });

      When('the inbox is opened and unlocked', async () => {
        render(<Inbox />);
        await unlockInbox(mnemonic);
      });

      Then('the message is shown as unreadable in the inbox', async () => {
        expect(await screen.findByText('Unreadable message.')).toBeInTheDocument();
      });
    },
  );

  Scenario(
    "mw-tfne4.26: a slow decrypt tail from a previous inbox does not corrupt the next one's message",
    ({ Given, And, When, Then }) => {
      let mnemonic2: string;

      Given('an inbox was unlocked with one message and its decrypt tail is still resolving', async () => {
        await freshCompose();
        const him1 = await saveVaultForHim();
        const payload1 = encryptMessage({
          text: 'leaked tail catch',
          class: 'message',
          senderPrivateKeyHex: SENDER_KEY.toHex(),
          recipientPublicKeyHex: him1.publicKeyHex,
        });
        vi.stubGlobal('fetch', messagesFetchMock([{ seq: 1, txid: 'a'.repeat(64), vout: 0, payload: payload1 }]));

        // Simulates the real leak: this decryptPendingMessages call is still
        // in flight when unlockInbox() below returns (it only waits for the
        // Lock button). The delay's exact size doesn't matter once freshCompose
        // drains it — it only needs to still be pending when the next step's
        // freshCompose() runs.
        const realDecryptPendingMessages = inboxService.decryptPendingMessages;
        decryptPendingMessagesSpy.mockImplementationOnce(async (key: Uint8Array) => {
          await new Promise((resolve) => setTimeout(resolve, 400));
          return realDecryptPendingMessages(key);
        });

        render(<Inbox />);
        await unlockInbox(him1.mnemonic);
      });

      And('a new scenario clears the tables and unlocks a second inbox with its own message', async () => {
        await freshCompose();
        const him2 = await saveVaultForHim();
        mnemonic2 = him2.mnemonic;
        const payload2 = encryptMessage({
          text: 'new scenario catch',
          class: 'message',
          senderPrivateKeyHex: SENDER_KEY.toHex(),
          recipientPublicKeyHex: him2.publicKeyHex,
        });
        vi.stubGlobal('fetch', messagesFetchMock([{ seq: 1, txid: 'a'.repeat(64), vout: 0, payload: payload2 }]));
      });

      When("the second inbox's decrypt tail is given a chance to catch up", async () => {
        render(<Inbox />);
        await screen.findByText('Locked');
        await unlockInbox(mnemonic2);
      });

      Then('the second message is shown decrypted, not marked unreadable', async () => {
        expect(await screen.findByText('new scenario catch')).toBeInTheDocument();
        expect(screen.queryByText('Unreadable message.')).not.toBeInTheDocument();
      });
    },
  );

  Scenario(
    'mw-1589l.27 AC2: a message he sent is shown with his own words, not "Sent message."',
    ({ Given, When, Then }) => {
      let mnemonic: string;

      Given('the backend has one message record he sent to the Mayor', async () => {
        await freshCompose();
        const him = await saveVaultForHim();
        mnemonic = him.mnemonic;
        const payload = encryptMessage({
          text: 'on my way, be there by six',
          class: 'message',
          senderPrivateKeyHex: await privateKeyHexFromMnemonic(mnemonic),
          recipientPublicKeyHex: MAYOR_KEY.toPublicKey().toString(),
        });
        vi.stubGlobal('fetch', messagesFetchMock([{ seq: 1, txid: 'a'.repeat(64), vout: 0, payload }]));
      });

      When('the inbox is opened and unlocked', async () => {
        render(<Inbox />);
        await unlockInbox(mnemonic);
      });

      Then('the sent message is shown with his words in the inbox', async () => {
        expect(await screen.findByText('on my way, be there by six')).toBeInTheDocument();
      });
    },
  );

  Scenario(
    'mw-1589l.27 AC3: a sent row stored before this change is decrypted on the next sync',
    ({ Given, When, Then }) => {
      let mnemonic: string;

      Given('a sent message row was already stored without plaintext', async () => {
        await freshCompose();
        const him = await saveVaultForHim();
        mnemonic = him.mnemonic;
        const payload = encryptMessage({
          text: 'already on the chain before this shipped',
          class: 'message',
          senderPrivateKeyHex: await privateKeyHexFromMnemonic(mnemonic),
          recipientPublicKeyHex: MAYOR_KEY.toPublicKey().toString(),
        });
        // Simulates a row synced before this feature existed: stored with the
        // ciphertext, no plaintext, direction already known to be sent.
        await messagesRepo.put({
          id: `${'a'.repeat(64)}:0`,
          txid: 'a'.repeat(64),
          vout: 0,
          seq: 1,
          class: payload.class,
          to: payload.to,
          from: payload.from,
          ts: payload.ts,
          ciphertext: payload.ct,
          direction: 'sent',
          read: false,
        });
        vi.stubGlobal('fetch', messagesFetchMock([]));
      });

      When('the inbox is opened and unlocked', async () => {
        render(<Inbox />);
        await unlockInbox(mnemonic);
      });

      Then('the sent message is shown with his words in the inbox', async () => {
        expect(await screen.findByText('already on the chain before this shipped')).toBeInTheDocument();
      });
    },
  );

  Scenario(
    'mw-1589l.27 AC3: a sent record his key cannot read as sender still shows "Sent message."',
    ({ Given, When, Then }) => {
      let mnemonic: string;

      Given('the backend has one sent message record his key cannot read as sender', async () => {
        await freshCompose();
        const him = await saveVaultForHim();
        mnemonic = him.mnemonic;
        // Encrypted by someone else, to the Mayor, then forged to claim he sent it —
        // his key cannot recompute this ciphertext's symmetric key as sender.
        const payload = encryptMessage({
          text: 'not really from him',
          class: 'message',
          senderPrivateKeyHex: SENDER_KEY.toHex(),
          recipientPublicKeyHex: MAYOR_KEY.toPublicKey().toString(),
        });
        const forged = { ...payload, from: him.publicKeyHex };
        vi.stubGlobal('fetch', messagesFetchMock([{ seq: 1, txid: 'a'.repeat(64), vout: 0, payload: forged }]));
      });

      When('the inbox is opened and unlocked', async () => {
        render(<Inbox />);
        await unlockInbox(mnemonic);
      });

      Then('the message is shown as "Sent message." in the inbox', async () => {
        expect(await screen.findByText('Sent message.')).toBeInTheDocument();
      });
    },
  );

  Scenario("mw-tfne4.15 AC1: the Mayor's public key wraps instead of overflowing the screen", ({ Given, Then }) => {
    Given('the compose screen is opened with an unlocked key and a recipient set', async () => {
      await freshCompose();
      await openComposeUnlockedWithRecipient();
    });

    Then("the Mayor's public key is rendered in an element that wraps long text", () => {
      const keyElement = screen.getByText(MAYOR_KEY.toPublicKey().toString());
      expect(keyElement.className).toContain('break-all');
    });
  });

  Scenario(
    'mw-tfne4.18 AC2: a dismissed fingerprint prompt on the inbox screen says "Unlock cancelled"',
    ({ Given, When, Then, And }) => {
      Given('the inbox is opened with a PRF-wrapped vault and the fingerprint prompt will be dismissed', async () => {
        await freshCompose();
        await savePrfVaultWithDismissedPrompt();
        render(<Inbox />);
        await screen.findByRole('button', { name: 'Unlock with your fingerprint' });
      });

      When('"Unlock with your fingerprint" is tapped', async () => {
        await userEvent.click(screen.getByRole('button', { name: 'Unlock with your fingerprint' }));
      });

      Then('the error says "Unlock cancelled. Tap Unlock to try again."', async () => {
        expect(await screen.findByRole('alert')).toHaveTextContent('Unlock cancelled. Tap Unlock to try again.');
      });

      And('the raw browser sentence and the w3.org link never appear', () => {
        expect(screen.queryByText(/timed out or was not allowed/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/w3\.org/i)).not.toBeInTheDocument();
      });

      And('"Unlock with your fingerprint" is still offered', () => {
        expect(screen.getByRole('button', { name: 'Unlock with your fingerprint' })).toBeInTheDocument();
      });
    },
  );

  Scenario(
    'mw-tfne4.18 AC2: a dismissed fingerprint prompt on the send screen says "Unlock cancelled"',
    ({ Given, When, Then, And }) => {
      Given('the compose screen is opened with a PRF-wrapped vault and the fingerprint prompt will be dismissed', async () => {
        await freshCompose();
        await savePrfVaultWithDismissedPrompt();
        render(<Compose />);
        await screen.findByRole('button', { name: 'Unlock with your fingerprint' });
      });

      When('"Unlock with your fingerprint" is tapped', async () => {
        await userEvent.click(screen.getByRole('button', { name: 'Unlock with your fingerprint' }));
      });

      Then('the error says "Unlock cancelled. Tap Unlock to try again."', async () => {
        expect(await screen.findByRole('alert')).toHaveTextContent('Unlock cancelled. Tap Unlock to try again.');
      });

      And('the raw browser sentence and the w3.org link never appear', () => {
        expect(screen.queryByText(/timed out or was not allowed/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/w3\.org/i)).not.toBeInTheDocument();
      });

      And('"Unlock with your fingerprint" is still offered', () => {
        expect(screen.getByRole('button', { name: 'Unlock with your fingerprint' })).toBeInTheDocument();
      });
    },
  );

  Scenario(
    'mw-f758y.21.1 AC1: a message naming a bead thread is stored under that thread',
    ({ Given, When, Then }) => {
      let mnemonic: string;

      Given('the backend has one message record addressed to him naming a bead thread', async () => {
        await freshCompose();
        const him = await saveVaultForHim();
        mnemonic = him.mnemonic;
        const plaintext = encodeThreadedMessage({ thread: { bead: 'mw-xyz12.3' }, text: 'meet at the usual place' });
        const payload = encryptMessage({
          text: plaintext,
          class: 'message',
          senderPrivateKeyHex: SENDER_KEY.toHex(),
          recipientPublicKeyHex: him.publicKeyHex,
        });
        vi.stubGlobal('fetch', messagesFetchMock([{ seq: 1, txid: 'a'.repeat(64), vout: 0, payload }]));
      });

      When('the inbox is opened and unlocked', async () => {
        render(<Inbox />);
        await unlockInbox(mnemonic);
      });

      Then('the stored message\'s thread is "bead:mw-xyz12.3"', async () => {
        const rows = await messagesRepo.getAll();
        expect(rows[0]?.thread).toBe('bead:mw-xyz12.3');
      });
    },
  );

  Scenario(
    "mw-f758y.21.1 AC2: a decision-needed message is stored under its own bead as its thread",
    ({ Given, When, Then }) => {
      let mnemonic: string;

      Given('the backend has one decision-needed message record addressed to him', async () => {
        await freshCompose();
        const him = await saveVaultForHim();
        mnemonic = him.mnemonic;
        const plaintext = encodeQuestion({
          bead: 'mw-xyz12.3',
          q: 'Ship the walking skeleton now, or wait for WireGuard?',
          rec: 'ship',
          options: ['ship', 'wait'],
        });
        const payload = encryptMessage({
          text: plaintext,
          class: 'decision-needed',
          senderPrivateKeyHex: SENDER_KEY.toHex(),
          recipientPublicKeyHex: him.publicKeyHex,
        });
        vi.stubGlobal('fetch', messagesFetchMock([{ seq: 1, txid: 'a'.repeat(64), vout: 0, payload }]));
      });

      When('the inbox is opened and unlocked', async () => {
        render(<Inbox />);
        await unlockInbox(mnemonic);
      });

      Then('the stored message\'s thread is "bead:mw-xyz12.3"', async () => {
        const rows = await messagesRepo.getAll();
        expect(rows[0]?.thread).toBe('bead:mw-xyz12.3');
      });
    },
  );

  Scenario(
    'mw-f758y.21.1 AC3: a message with no thread is stored under the general thread',
    ({ Given, When, Then }) => {
      let mnemonic: string;

      Given('the backend has one message record addressed to him with no thread', async () => {
        await freshCompose();
        const him = await saveVaultForHim();
        mnemonic = him.mnemonic;
        const payload = encryptMessage({
          text: 'meet at the usual place',
          class: 'message',
          senderPrivateKeyHex: SENDER_KEY.toHex(),
          recipientPublicKeyHex: him.publicKeyHex,
        });
        vi.stubGlobal('fetch', messagesFetchMock([{ seq: 1, txid: 'a'.repeat(64), vout: 0, payload }]));
      });

      When('the inbox is opened and unlocked', async () => {
        render(<Inbox />);
        await unlockInbox(mnemonic);
      });

      Then("the stored message's thread is the general thread", async () => {
        const rows = await messagesRepo.getAll();
        expect(rows[0]?.thread).toBeUndefined();
      });
    },
  );
});

afterAll(() => {
  cleanup();
  removeMockAuthenticator();
  vi.unstubAllGlobals();
});
