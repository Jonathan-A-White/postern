import Dexie, { type Table } from 'dexie';

export interface SettingRow {
  key: string;
  value: unknown;
}

export interface VaultRow {
  id: string;
  mode: 'prf' | 'phrase';
  ciphertext: ArrayBuffer;
  iv: Uint8Array;
  salt?: Uint8Array;
  credentialId?: ArrayBuffer;
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
