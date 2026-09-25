import { db, type SnapshotRow } from '../db';

const ROW_ID = 'current';

export const snapshotRepo = {
  async get(): Promise<SnapshotRow | undefined> {
    return db.snapshot.get(ROW_ID);
  },

  async save(row: Omit<SnapshotRow, 'id'>): Promise<void> {
    await db.snapshot.put({ id: ROW_ID, ...row });
  },
};
