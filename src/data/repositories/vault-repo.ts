import { db, type VaultRow } from '../db';

const VAULT_ID = 'default';

export const vaultRepo = {
  async get(): Promise<VaultRow | undefined> {
    return db.vault.get(VAULT_ID);
  },

  async save(row: Omit<VaultRow, 'id'>): Promise<void> {
    await db.vault.put({ id: VAULT_ID, ...row });
  },

  async clear(): Promise<void> {
    await db.vault.delete(VAULT_ID);
  },
};
