import Dexie, { type Table } from 'dexie';

export interface SettingRow {
  key: string;
  value: unknown;
}

// docs/protocol.md's message classes. Defined here (not in src/services/messages.ts,
// which re-exports it) so this file — the leaf data layer — never has to import from
// the service layer.
export type MessageClass = 'message' | 'decision-needed' | 'landing' | 'alarm';

export interface MessageRow {
  /** `${txid}:${vout}` — the record's own on-chain outpoint. */
  id: string;
  txid: string;
  vout: number;
  /** The backend's own sequence number (docs/api.md), kept for ordering ties. */
  seq: number;
  class: MessageClass;
  to: string;
  from: string;
  /** Unix seconds, from the payload (docs/protocol.md). */
  ts: number;
  /** The payload's base64 `ct` field. */
  ciphertext: string;
  /** Set once decrypted with the unlocked key. Never set for a message this phone sent. */
  plaintext?: string;
  direction: 'received' | 'sent';
  /** Set once decryption was attempted with the unlocked key and failed. */
  decryptFailed?: boolean;
  read: boolean;
}

// Recorded on a phrase-mode vault row so the UI can name, rather than merely
// report the absence of, the fingerprint ceremony's outcome:
// - webauthn-unavailable: this phone/browser has no WebAuthn platform authenticator.
// - passkey-created-without-prf: a passkey was created but returned no usable PRF secret.
// - prf-secret-empty: the passkey reported PRF support but its secret evaluated empty.
export type PrfFallbackReason = 'webauthn-unavailable' | 'passkey-created-without-prf' | 'prf-secret-empty';

export interface VaultRow {
  id: string;
  mode: 'prf' | 'phrase';
  ciphertext: ArrayBuffer;
  iv: Uint8Array;
  salt?: Uint8Array;
  credentialId?: ArrayBuffer;
  prfFallbackReason?: PrfFallbackReason;
  // The compressed secp256k1 public key (hex), derived once at creation and stored
  // in the clear: it is not secret, and the gate (src/services/licence.ts) needs it
  // to show the key's testnet address and check for a licence without unlocking
  // the wrapped private key.
  publicKeyHex: string;
}

class PosternDB extends Dexie {
  settings!: Table<SettingRow, string>;
  vault!: Table<VaultRow, string>;
  messages!: Table<MessageRow, string>;

  constructor() {
    super('PosternDB');

    this.version(1).stores({
      settings: 'key',
    });

    this.version(2).stores({
      settings: 'key',
      vault: 'id',
    });

    this.version(3).stores({
      settings: 'key',
      vault: 'id',
      messages: 'id, seq, ts, read',
    });
  }
}

export const db = new PosternDB();
