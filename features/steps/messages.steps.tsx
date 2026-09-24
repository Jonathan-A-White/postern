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
import { PrivateKey } from '@bsv/sdk';
import { Compose } from '../../src/compose';
import { db } from '../../src/data/db';
import { vaultRepo } from '../../src/data/repositories';
import {
  createMnemonic,
  deriveAesKeyFromPhrase,
  deriveMasterKey,
  publicKeyHexFromMasterKey,
  wrapKey,
} from '../../src/services/vault';
import { decryptMessage, encryptMessage, setMayorPublicKey, type MessageClass, type MessagePayload } from '../../src/services/messages';

const MAYOR_KEY = PrivateKey.fromHex('11'.repeat(32));
const SENDER_KEY = PrivateKey.fromHex('22'.repeat(32));
const EAVESDROPPER_KEY = PrivateKey.fromHex('33'.repeat(32));

async function freshCompose(): Promise<void> {
  cleanup();
  await db.vault.clear();
  await db.settings.clear();
  vi.unstubAllGlobals();
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
});

afterAll(() => {
  cleanup();
  vi.unstubAllGlobals();
});
