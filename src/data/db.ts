import Dexie, { type Table } from 'dexie';

export interface SettingRow {
  key: string;
  value: unknown;
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

  constructor() {
    super('PosternDB');

    this.version(1).stores({
      settings: 'key',
    });

    this.version(2).stores({
      settings: 'key',
      vault: 'id',
    });
  }
}

export const db = new PosternDB();
