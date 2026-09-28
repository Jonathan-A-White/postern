import { db, type MessageRow } from '../db';

export const messagesRepo = {
  async getAll(): Promise<MessageRow[]> {
    return db.messages.orderBy('ts').reverse().toArray();
  },

  /** Every message, oldest first — the order a conversation reads in. */
  async getAllOldestFirst(): Promise<MessageRow[]> {
    return db.messages.orderBy('ts').toArray();
  },

  /** One thread's messages, oldest first; undefined is the general thread. */
  async inThread(key: string | undefined): Promise<MessageRow[]> {
    return db.messages
      .orderBy('ts')
      .filter((row) => (key === undefined ? row.thread === undefined : row.thread === key))
      .toArray();
  },

  async get(id: string): Promise<MessageRow | undefined> {
    return db.messages.get(id);
  },

  /** The message a record's txid names (its outpoints are `${txid}:${vout}`). */
  async getByTxid(txid: string): Promise<MessageRow | undefined> {
    return db.messages.where('id').startsWith(`${txid}:`).first();
  },

  async put(row: MessageRow): Promise<void> {
    await db.messages.put(row);
  },

  async markRead(id: string): Promise<void> {
    await db.messages.update(id, { read: true });
  },

  async markThreadRead(key: string | undefined): Promise<void> {
    await db.messages
      .filter((row) => row.direction === 'received' && !row.read && row.thread === key)
      .modify({ read: true });
  },

  async countUnread(): Promise<number> {
    return db.messages.filter((row) => row.direction === 'received' && !row.read).count();
  },
};
