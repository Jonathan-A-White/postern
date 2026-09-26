import { db, type PendingSpendRow } from '../db';

export const pendingSpendsRepo = {
  async getAll(): Promise<PendingSpendRow[]> {
    return db.pendingSpends.toArray();
  },

  async add(entry: PendingSpendRow): Promise<void> {
    await db.pendingSpends.put(entry);
  },

  async removeMany(txids: string[]): Promise<void> {
    await db.pendingSpends.bulkDelete(txids);
  },
};
