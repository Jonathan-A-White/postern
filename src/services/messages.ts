// src/services/messages.ts — the postern message envelope: docs/protocol.md's
// { v, kind: 'msg', class, to, from, ts, ct } payload, BRC-78-encrypted (@bsv/sdk's
// EncryptedMessage, re-exported by spell-forge-bsv) so only the named recipient's
// private key can read the ciphertext, while every other field — including the
// class tag — stays plaintext JSON, readable by anyone who can see the chain.
import { PrivateKey, PublicKey, SymmetricKey, Utils } from '@bsv/sdk';
import { EncryptedMessage } from 'spell-forge-bsv';
import { settingsRepo } from '../data/repositories';
import type { MessageClass } from '../data/db';

export type { MessageClass };

/** The postern message channel's own testnet anchor (docs/protocol.md §3) — not
 * spell-forge-bsv's chainConfig.anchorAddress, which is the leaderboard's. */
export const ANCHOR_ADDRESS = 'mt6vaAWeFxu2qC6pPs7bsqTNvv87dCwMW5';

/** The API base every fetch in this app makes: a relative path on the app's own
 * origin, resolved at runtime — no build-time host configuration needed. */
export const API_BASE = '/api';

export interface MessagePayload {
  v: 1;
  kind: 'msg';
  class: MessageClass;
  to: string;
  from: string;
  ts: number;
  ct: string;
}

export interface EncryptMessageParams {
  text: string;
  class: MessageClass;
  senderPrivateKeyHex: string;
  recipientPublicKeyHex: string;
  /** Unix seconds. Defaults to now — a fixed value lets tests build reproducible payloads. */
  ts?: number;
}

/** Builds a docs/protocol.md record payload: the text BRC-78-encrypted for the
 * recipient, with the class tag and both public keys left in the clear. */
export function encryptMessage(params: EncryptMessageParams): MessagePayload {
  const sender = PrivateKey.fromHex(params.senderPrivateKeyHex);
  const recipient = PublicKey.fromString(params.recipientPublicKeyHex);
  const plaintextBytes = Utils.toArray(params.text, 'utf8');
  const encrypted = EncryptedMessage.encrypt(plaintextBytes, sender, recipient);

  return {
    v: 1,
    kind: 'msg',
    class: params.class,
    to: recipient.toString(),
    from: sender.toPublicKey().toString(),
    ts: params.ts ?? Math.floor(Date.now() / 1000),
    ct: Utils.toBase64(encrypted),
  };
}

/** Decrypts a record payload's `ct` field with the recipient's private key. Throws
 * if `recipientPrivateKeyHex` isn't the key the message was encrypted for. */
export function decryptMessage(payload: MessagePayload, recipientPrivateKeyHex: string): string {
  const recipient = PrivateKey.fromHex(recipientPrivateKeyHex);
  const encryptedBytes = Utils.toArray(payload.ct, 'base64');
  const plaintextBytes = EncryptedMessage.decrypt(encryptedBytes, recipient);
  return Utils.toUTF8(plaintextBytes);
}

/** BRC-78's envelope version tag (docs/protocol.md §2; @bsv/sdk's EncryptedMessage). */
const BRC78_VERSION = '42421033';

/**
 * Decrypts a record payload's `ct` field with the SENDER's own private key — the
 * same symmetric key `encryptMessage` derived, recomputed from the envelope's own
 * header (docs/protocol.md §2): the recipient's public key and the random keyID
 * travel there in the clear alongside the sender's public key. `EncryptedMessage.decrypt`
 * itself insists the caller be the recipient (it compares the header's recipient key
 * against the caller's), so this rebuilds the same BRC-42 derivation from the sender's
 * side, directly from the SDK's exported `PrivateKey`, `PublicKey` and `SymmetricKey`
 * primitives. Throws a clear error if `senderPrivateKeyHex` isn't the key this message
 * was sent from.
 */
export function decryptMessageAsSender(payload: MessagePayload, senderPrivateKeyHex: string): string {
  const sender = PrivateKey.fromHex(senderPrivateKeyHex);
  const encryptedBytes = Utils.toArray(payload.ct, 'base64');
  const reader = new Utils.Reader(encryptedBytes);

  const version = Utils.toHex(reader.read(4));
  if (version !== BRC78_VERSION) {
    throw new Error(`Message version mismatch: expected ${BRC78_VERSION}, received ${version}`);
  }
  const headerSenderHex = Utils.toHex(reader.read(33));
  const recipient = PublicKey.fromString(Utils.toHex(reader.read(33)));
  if (headerSenderHex !== sender.toPublicKey().toString()) {
    throw new Error('This key is not the sender this message was encrypted by.');
  }
  const keyID = Utils.toBase64(reader.read(32));
  const encrypted = reader.read(reader.bin.length - reader.pos);

  const invoiceNumber = `2-message encryption-${keyID}`;
  const signingPriv = sender.deriveChild(recipient, invoiceNumber);
  const recipientPub = recipient.deriveChild(sender, invoiceNumber);
  const sharedSecret = signingPriv.deriveSharedSecret(recipientPub);
  const symmetricKey = new SymmetricKey(sharedSecret.encode(true).slice(1));

  const plaintextBytes = symmetricKey.decrypt(encrypted) as number[];
  return Utils.toUTF8(plaintextBytes);
}

/** Decrypts the raw BRC-78 ciphertext GET /snapshot returns (docs/protocol.md §7):
 * base64 text on its own, not wrapped in a `{v, kind, ...}` envelope like a message,
 * since there is exactly one recipient and one purpose. */
export function decryptSnapshotCiphertext(base64Ciphertext: string, recipientPrivateKeyHex: string): string {
  const recipient = PrivateKey.fromHex(recipientPrivateKeyHex);
  const encryptedBytes = Utils.toArray(base64Ciphertext, 'base64');
  const plaintextBytes = EncryptedMessage.decrypt(encryptedBytes, recipient);
  return Utils.toUTF8(plaintextBytes);
}

const MAYOR_PUBLIC_KEY_SETTING_KEY = 'mayor-public-key';

/** The Mayor's public key, pasted once and kept in Dexie — the recipient every
 * message from this phone is encrypted to. */
export async function getMayorPublicKey(): Promise<string | undefined> {
  return (await settingsRepo.get(MAYOR_PUBLIC_KEY_SETTING_KEY)) as string | undefined;
}

export async function setMayorPublicKey(publicKeyHex: string): Promise<void> {
  await settingsRepo.set(MAYOR_PUBLIC_KEY_SETTING_KEY, publicKeyHex);
}
