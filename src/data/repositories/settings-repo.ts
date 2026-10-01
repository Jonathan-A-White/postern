import { db, type ArchiveChoices, type PromptsCache } from '../db';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../../push/classOptions';
import type { NotificationSettingsMap } from '../../push/classOptions';

const NOTIFICATION_SETTINGS_KEY = 'notificationSettings';
const THREAD_ARCHIVE_KEY = 'threadArchive';
const PENDING_LATERS_KEY = 'pendingLaters';
const ANSWERED_RING_KEY = 'answeredRing';
const PROMPTS_KEY = 'prompts';
// Also stored through the generic get/set: 'lastShareThread' is the thread key he shared to last
// (src/cockpit/ShareScreen.tsx, mw-dw0i6.2); a string, never cleared.

export const settingsRepo = {
  async get(key: string): Promise<unknown> {
    const row = await db.settings.get(key);
    return row?.value;
  },

  async set(key: string, value: unknown): Promise<void> {
    await db.settings.put({ key, value });
  },

  /** The stored per-class notification switches, or mw-f758y.5's decided
   * defaults for any class (or all of them) never stored. Read by both the
   * settings screen and src/sw.ts's push handler, so they never drift apart. */
  async getNotificationSettings(): Promise<NotificationSettingsMap> {
    const row = await db.settings.get(NOTIFICATION_SETTINGS_KEY);
    const stored = row?.value as Partial<NotificationSettingsMap> | undefined;
    return {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...stored,
    };
  },

  async setNotificationSettings(settings: NotificationSettingsMap): Promise<void> {
    await db.settings.put({ key: NOTIFICATION_SETTINGS_KEY, value: settings });
  },

  /** His hand-made archive and unarchive choices, per thread key (mw-2y46l.6). */
  async getThreadArchive(): Promise<ArchiveChoices> {
    const row = await db.settings.get(THREAD_ARCHIVE_KEY);
    return (row?.value as ArchiveChoices | undefined) ?? {};
  },

  /** Records that he archived (or brought back) a thread, stamped now. */
  async setThreadArchived(key: string, archived: boolean): Promise<void> {
    await db.transaction('rw', db.settings, async () => {
      const row = await db.settings.get(THREAD_ARCHIVE_KEY);
      const choices = (row?.value as ArchiveChoices | undefined) ?? {};
      await db.settings.put({ key: THREAD_ARCHIVE_KEY, value: { ...choices, [key]: { archived, at: Date.now() } } });
    });
  },

  /** The ring he last opened the Talk line from (docs/protocol.md §21). */
  async setAnsweredRing(txid: string): Promise<void> {
    await db.settings.put({ key: ANSWERED_RING_KEY, value: txid });
  },

  /** A Later tap with no open window to send it: kept for the next open (src/sw.ts), once per ring. */
  async addPendingLater(ringTxid: string): Promise<void> {
    await db.transaction('rw', db.settings, async () => {
      const row = await db.settings.get(PENDING_LATERS_KEY);
      const waiting = (row?.value as string[] | undefined) ?? [];
      if (!waiting.includes(ringTxid)) await db.settings.put({ key: PENDING_LATERS_KEY, value: [...waiting, ringTxid] });
    });
  },

  /** The Later taps waiting for the app, handed over once. */
  async takePendingLaters(): Promise<string[]> {
    return db.transaction('rw', db.settings, async () => {
      const row = await db.settings.get(PENDING_LATERS_KEY);
      if (row) await db.settings.delete(PENDING_LATERS_KEY);
      return (row?.value as string[] | undefined) ?? [];
    });
  },

  /** The saved prompts as the backend last answered, with the time (src/services/prompts.ts). */
  async getPromptsCache(): Promise<PromptsCache | undefined> {
    const row = await db.settings.get(PROMPTS_KEY);
    return row?.value as PromptsCache | undefined;
  },

  async setPromptsCache(cache: PromptsCache): Promise<void> {
    await db.settings.put({ key: PROMPTS_KEY, value: cache });
  },

  async resetNotificationSettings(): Promise<void> {
    await db.settings.delete(NOTIFICATION_SETTINGS_KEY);
  },
};
