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

  /** The oldest row of a lane not yet taken by a backend or the chain: Talk turns are one lane, everything else the other (mw-jrx0s.21). A failed row is not pending, so the row behind it is the head. */
  async head(lane: 'turn' | 'main'): Promise<OutboxRow | undefined> {
    return db.outbox
      .where('state')
      .equals('pending')
      .filter((row) => (row.kind === 'turn') === (lane === 'turn'))
      .first();
  },

  async sent(): Promise<OutboxRow[]> {
    return db.outbox.where('state').equals('sent').sortBy('id');
  },

  async update(id: number, patch: Partial<OutboxRow>): Promise<void> {
    await db.outbox.update(id, patch);
  },

  /** Discard: forgets one row (a refused one he does not want sent). */
  async remove(id: number): Promise<void> {
    await db.outbox.delete(id);
  },

  /** Retry: puts a refused row back in the queue, in its old place, as if it had never been tried. */
  async requeue(id: number): Promise<void> {
    await db.outbox.update(id, { state: 'pending', attempts: 0, nextAt: undefined, failure: undefined });
  },

  /** Forgets acked rows that were acked before `before` (ms since the epoch of their creation). */
  async pruneAcked(before: number): Promise<void> {
    await db.outbox.where('state').equals('acked').filter((row) => row.created < before).delete();
  },
};
