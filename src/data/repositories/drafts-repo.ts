import { db } from '../db';
import { threadKey, type ThreadRef } from '../../services/threads';

const PREFIX = 'draft:';

// What he has typed and not sent, kept on this phone only (mw-gq6.250): one settings row per
// channel, and one per reply under a post. Never a record, a push or a request.
export const draftsRepo = {
  /** The row a composer's draft lives in: its channel (the general one when none), and the post a reply answers. */
  keyFor(thread: ThreadRef | undefined, re?: string): string {
    return `${PREFIX}${threadKey(thread) ?? 'general'}${re ? `|re:${re}` : ''}`;
  },

  async get(key: string): Promise<string | undefined> {
    const row = await db.settings.get(key);
    return typeof row?.value === 'string' && row.value ? row.value : undefined;
  },

  /** An empty text removes the draft. */
  async save(key: string, text: string): Promise<void> {
    if (text) await db.settings.put({ key, value: text });
    else await db.settings.delete(key);
  },

  async clear(key: string): Promise<void> {
    await db.settings.delete(key);
  },
};
