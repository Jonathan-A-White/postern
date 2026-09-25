import { db, type MessageRow } from '../db';

export const messagesRepo = {
  async getAll(): Promise<MessageRow[]> {
    return db.messages.orderBy('ts').reverse().toArray();
  },

  async get(id: string): Promise<MessageRow | undefined> {
    return db.messages.get(id);
  },

  async put(row: MessageRow): Promise<void> {
    await db.messages.put(row);
  },

  async markRead(id: string): Promise<void> {
    await db.messages.update(id, { read: true });
  },

  async countUnread(): Promise<number> {
    return db.messages.filter((row) => row.direction === 'received' && !row.read).count();
  },
};
