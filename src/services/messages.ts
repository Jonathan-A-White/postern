// src/services/messages.ts — the postern message envelope: docs/protocol.md's
// { v, kind: 'msg', class, to, from, ts, ct } payload, BRC-78-encrypted (@bsv/sdk's
// EncryptedMessage, re-exported by spell-forge-bsv) so only the named recipient's
// private key can read the ciphertext, while every other field — including the
// class tag — stays plaintext JSON, readable by anyone who can see the chain.
import { PrivateKey, PublicKey, Utils } from '@bsv/sdk';
import { EncryptedMessage } from 'spell-forge-bsv';
import { settingsRepo } from '../data/repositories';

/** The postern message channel's own testnet anchor (docs/protocol.md §3) — not
 * spell-forge-bsv's chainConfig.anchorAddress, which is the leaderboard's. */
export const ANCHOR_ADDRESS = 'mt6vaAWeFxu2qC6pPs7bsqTNvv87dCwMW5';

/** The API base every fetch in this app makes: a relative path on the app's own
 * origin, resolved at runtime — no build-time host configuration needed. */
export const API_BASE = '/api';

export type MessageClass = 'message' | 'decision-needed' | 'landing' | 'alarm';

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

const MAYOR_PUBLIC_KEY_SETTING_KEY = 'mayor-public-key';

/** The Mayor's public key, pasted once and kept in Dexie — the recipient every
 * message from this phone is encrypted to. */
export async function getMayorPublicKey(): Promise<string | undefined> {
  return (await settingsRepo.get(MAYOR_PUBLIC_KEY_SETTING_KEY)) as string | undefined;
}

export async function setMayorPublicKey(publicKeyHex: string): Promise<void> {
  await settingsRepo.set(MAYOR_PUBLIC_KEY_SETTING_KEY, publicKeyHex);
}
