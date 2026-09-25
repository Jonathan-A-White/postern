// scripts/generate-fixture.ts — regenerates docs/fixtures/protocol-vectors.json,
// the TypeScript-side reference vectors millwright's Go port
// (infrastructure/postern) checks itself against (docs/protocol.md §5):
// encryptMessage's output, the record script encodeRecordScript builds from it,
// and the fully signed send transaction built the same way src/services/send.ts
// builds one — all from fixed inputs, with randomness pinned so this always
// writes the same file.
//
// Run with `npm run fixture`.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { P2PKH, PrivateKey, SatoshisPerKilobyte, Transaction, Utils } from '@bsv/sdk';
import { chainConfig, encodeRecordScript } from 'spell-forge-bsv';
import { ANCHOR_ADDRESS, encryptMessage, type MessagePayload } from '../src/services/messages.ts';

export const FIXTURE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/fixtures/protocol-vectors.json');

const SENDER_PRIVATE_KEY_HEX = '0000000000000000000000000000000000000000000000000000000000003039';
const RECIPIENT_PRIVATE_KEY_HEX = '0000000000000000000000000000000000000000000000000000000000010932';
const PLAINTEXT = 'rendezvous at dawn, bring the ledger';
const MESSAGE_CLASS: MessagePayload['class'] = 'message';
const MESSAGE_TS = 1758800000;
const FAKE_UTXO = { txid: 'f'.repeat(64), vout: 0, satoshis: 100_000 };
const ANCHOR_OUTPUT_SATOSHIS = 1;

export interface ProtocolFixture {
  inputs: {
    senderPrivateKeyHex: string;
    senderPublicKeyHex: string;
    recipientPrivateKeyHex: string;
    recipientPublicKeyHex: string;
    plaintext: string;
    messageClass: MessagePayload['class'];
    ts: number;
    utxo: { txid: string; vout: number; satoshis: number; script: string };
  };
  encryptMessage: MessagePayload;
  recordScriptHex: string;
  transaction: { rawtxHex: string; txid: string };
}

/**
 * Deterministic stand-in for Web Crypto's getRandomValues, seeded so
 * EncryptedMessage.encrypt's keyID and the AES-GCM IV it derives from — both
 * normally drawn from real entropy — come out the same on every run.
 */
function deterministicRandomValues(seed: string): Crypto['getRandomValues'] {
  let counter = 0;
  return (<T extends ArrayBufferView | null>(array: T): T => {
    if (array === null) return array;
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    let offset = 0;
    while (offset < bytes.length) {
      const digest = createHash('sha256').update(`${seed}:${counter}`).digest();
      counter += 1;
      const take = Math.min(digest.length, bytes.length - offset);
      bytes.set(digest.subarray(0, take), offset);
      offset += take;
    }
    return array;
  }) as Crypto['getRandomValues'];
}

export async function buildFixture(): Promise<ProtocolFixture> {
  const sender = PrivateKey.fromHex(SENDER_PRIVATE_KEY_HEX);
  const recipient = PrivateKey.fromHex(RECIPIENT_PRIVATE_KEY_HEX);
  const address = sender.toAddress(chainConfig.network);
  const lockingScript = new P2PKH().lock(address);

  const originalGetRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  globalThis.crypto.getRandomValues = deterministicRandomValues('postern-protocol-fixture-v1');
  let payload: MessagePayload;
  try {
    payload = encryptMessage({
      text: PLAINTEXT,
      class: MESSAGE_CLASS,
      senderPrivateKeyHex: SENDER_PRIVATE_KEY_HEX,
      recipientPublicKeyHex: recipient.toPublicKey().toString(),
      ts: MESSAGE_TS,
    });
  } finally {
    globalThis.crypto.getRandomValues = originalGetRandomValues;
  }

  const recordScript = encodeRecordScript(Utils.toArray(JSON.stringify(payload), 'utf8'));

  const transaction = new Transaction();
  const sourceTransaction = new Transaction();
  sourceTransaction.outputs[FAKE_UTXO.vout] = { satoshis: FAKE_UTXO.satoshis, lockingScript };
  transaction.addInput({
    sourceTransaction,
    sourceTXID: FAKE_UTXO.txid,
    sourceOutputIndex: FAKE_UTXO.vout,
    unlockingScriptTemplate: new P2PKH().unlock(sender),
  });
  transaction.addOutput({ lockingScript: recordScript, satoshis: 0 });
  transaction.addP2PKHOutput(ANCHOR_ADDRESS, ANCHOR_OUTPUT_SATOSHIS);
  transaction.addP2PKHOutput(address);
  await transaction.fee(new SatoshisPerKilobyte(chainConfig.feeRateSatPerKb));
  await transaction.sign();

  return {
    inputs: {
      senderPrivateKeyHex: SENDER_PRIVATE_KEY_HEX,
      senderPublicKeyHex: sender.toPublicKey().toString(),
      recipientPrivateKeyHex: RECIPIENT_PRIVATE_KEY_HEX,
      recipientPublicKeyHex: recipient.toPublicKey().toString(),
      plaintext: PLAINTEXT,
      messageClass: MESSAGE_CLASS,
      ts: MESSAGE_TS,
      utxo: { ...FAKE_UTXO, script: lockingScript.toHex() },
    },
    encryptMessage: payload,
    recordScriptHex: recordScript.toHex(),
    transaction: { rawtxHex: transaction.toHex(), txid: transaction.id('hex') },
  };
}

export function serializeFixture(fixture: ProtocolFixture): string {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

async function main(): Promise<void> {
  const fixture = await buildFixture();
  writeFileSync(FIXTURE_PATH, serializeFixture(fixture));
  console.log(`Wrote ${FIXTURE_PATH}`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
