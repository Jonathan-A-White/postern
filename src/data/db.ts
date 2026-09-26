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
  /** Set once decrypted with the unlocked key: as the recipient for a received
   * message, or as the sender's own key for a message this phone sent
   * (mw-1589l.27) — the same shared key either side of a message can derive
   * (docs/protocol.md §2). */
  plaintext?: string;
  direction: 'received' | 'sent';
  /** Set once decryption was attempted with the unlocked key and failed. */
  decryptFailed?: boolean;
  read: boolean;
  /** The thread this message belongs to (docs/protocol.md §1 and §6), as
   * src/services/threads.ts's `threadKey` encodes it: `bead:<id>`, `topic:<name>`,
   * or absent for the general thread — including every row stored before this
   * field existed. Computed once the message decrypts; a message that fails to
   * decrypt, or hasn't yet, reads as the general thread until it does. */
  thread?: string;
}

// Recorded on a phrase-mode vault row so the UI can name, rather than merely
// report the absence of, the fingerprint ceremony's outcome:
// - webauthn-unavailable: this phone/browser has no WebAuthn platform authenticator.
// - passkey-created-without-prf: a passkey was created but returned no usable PRF secret.
// - prf-secret-empty: the passkey reported PRF support but its secret evaluated empty.
export type PrfFallbackReason = 'webauthn-unavailable' | 'passkey-created-without-prf' | 'prf-secret-empty';

// One row (id: 'current'), holding the last snapshot the app decrypted successfully
// (docs/protocol.md §7): plaintext kept whole rather than parsed apart per epic, so
// a schema change to the snapshot shape never needs a Dexie migration. `written_at`
// is duplicated from the plaintext so its age can be shown without parsing JSON.
export interface SnapshotRow {
  id: string;
  plaintext: string;
  written_at: string;
}

// One row per bead his tap or free-text reply has already answered (mw-tfne4.5):
// recorded the moment the reply broadcasts, so Needs you can hide the bead at once
// rather than waiting for the snapshot's next tick to catch up.
export interface AnswerRow {
  bead: string;
  answer: string;
  txid: string;
  /** Unix seconds. */
  ts: number;
}

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
  snapshot!: Table<SnapshotRow, string>;
  answers!: Table<AnswerRow, string>;

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

    this.version(4).stores({
      settings: 'key',
      vault: 'id',
      messages: 'id, seq, ts, read',
      snapshot: 'id',
    });

    this.version(5).stores({
      settings: 'key',
      vault: 'id',
      messages: 'id, seq, ts, read',
      snapshot: 'id',
      answers: 'bead',
    });

    this.version(6).stores({
      settings: 'key',
      vault: 'id',
      messages: 'id, seq, ts, read, thread',
      snapshot: 'id',
      answers: 'bead',
    });
  }
}

export const db = new PosternDB();
