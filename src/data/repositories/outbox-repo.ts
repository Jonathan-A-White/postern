import { db, type OutboxRow } from '../db';

/** mw-jrx0s.10: the outgoing queue (src/services/outbox.ts sends it, the screens read it). */
export const outboxRepo = {
  /** Writes a new row, pending, and resolves with its id (ids rise in the order rows were written). */
  async add(row: Omit<OutboxRow, 'id' | 'attempts' | 'state' | 'created'> & { created?: number }): Promise<number> {
    return db.outbox.add({ ...row, created: row.created ?? Date.now(), attempts: 0, state: 'pending' });
  },

  /** Every row, oldest first. */
  async all(): Promise<OutboxRow[]> {
    return db.outbox.orderBy('id').toArray();
  },

  /** The rows still on their way or not yet seen coming back: everything but the acked. */
  async open(): Promise<OutboxRow[]> {
    return db.outbox.orderBy('id').filter((row) => row.state !== 'acked').toArray();
  },

  /** The oldest row not yet taken by a backend or the chain. */
  async head(): Promise<OutboxRow | undefined> {
    return db.outbox.where('state').equals('pending').first();
  },

  async sent(): Promise<OutboxRow[]> {
    return db.outbox.where('state').equals('sent').sortBy('id');
  },

  async update(id: number, patch: Partial<OutboxRow>): Promise<void> {
    await db.outbox.update(id, patch);
  },

  /** Forgets acked rows that were acked before `before` (ms since the epoch of their creation). */
  async pruneAcked(before: number): Promise<void> {
    await db.outbox.where('state').equals('acked').filter((row) => row.created < before).delete();
  },
};
