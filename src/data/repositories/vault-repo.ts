import { db, type VaultRow } from '../db';
import { accountsRepo } from './accounts-repo';

/** The active account's vault row (its keyRef); account 1's is 'default', as it has always been. */
const vaultId = (): string => accountsRepo.activeNow().keyRef;

export const vaultRepo = {
  async get(): Promise<VaultRow | undefined> {
    return db.vault.get(vaultId());
  },

  async save(row: Omit<VaultRow, 'id'>): Promise<void> {
    await db.vault.put({ id: vaultId(), ...row });
  },

  async clear(): Promise<void> {
    await db.vault.delete(vaultId());
  },
};
