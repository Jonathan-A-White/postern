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

  /** Marks the thread's received messages read; resolves with the txids it just marked. */
  async markThreadRead(key: string | undefined): Promise<string[]> {
    const unread = db.messages.filter((row) => row.direction === 'received' && !row.read && row.thread === key);
    const txids = (await unread.toArray()).map((row) => row.txid);
    await unread.modify({ read: true });
    return txids;
  },

  async countUnread(): Promise<number> {
    return db.messages.filter((row) => row.direction === 'received' && !row.read).count();
  },
};
