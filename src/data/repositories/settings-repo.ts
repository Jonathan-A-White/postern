import { db } from '../db';

export const settingsRepo = {
  async get(key: string): Promise<unknown> {
    const row = await db.settings.get(key);
    return row?.value;
  },

  async set(key: string, value: unknown): Promise<void> {
    await db.settings.put({ key, value });
  },
};
