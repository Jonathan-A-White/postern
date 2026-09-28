import { db, type ViewRow, type BeadDetailRow, type SessionRow, type ShareRow } from '../db';

const CURRENT = 'current';

/** plans/0021: the last decrypted live view (docs/protocol.md §11). */
export const viewRepo = {
  async get(): Promise<ViewRow | undefined> {
    return db.view.get(CURRENT);
  },

  async save(row: Omit<ViewRow, 'id'>): Promise<void> {
    await db.view.put({ id: CURRENT, ...row });
  },
};

/** plans/0021: decrypted bead details (docs/protocol.md §12), newest fetch wins. */
export const beadDetailsRepo = {
  async get(id: string): Promise<BeadDetailRow | undefined> {
    return db.beadDetails.get(id);
  },

  async getAll(): Promise<BeadDetailRow[]> {
    return db.beadDetails.toArray();
  },

  async save(row: BeadDetailRow): Promise<void> {
    await db.beadDetails.put(row);
  },
};

/** plans/0021 decision 12: files shared in from the share sheet, until placed. */
export const sharesRepo = {
  async get(id: string): Promise<ShareRow | undefined> {
    return db.shares.get(id);
  },

  async latest(): Promise<ShareRow | undefined> {
    return db.shares.orderBy('createdAt').last();
  },

  async put(row: ShareRow): Promise<void> {
    await db.shares.put(row);
  },

  async remove(id: string): Promise<void> {
    await db.shares.delete(id);
  },
};

const SESSION_ROW = 'daily';

/** plans/0021 decision 14: the one wrapped daily session. */
export const sessionRepo = {
  async get(): Promise<SessionRow | undefined> {
    return db.session.get(SESSION_ROW);
  },

  async save(row: Omit<SessionRow, 'id'>): Promise<void> {
    await db.session.put({ id: SESSION_ROW, ...row });
  },

  async clear(): Promise<void> {
    await db.session.delete(SESSION_ROW);
  },
};
