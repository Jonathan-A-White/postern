import { db, type ArchiveChoices } from '../db';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../../push/classOptions';
import type { NotificationSettingsMap } from '../../push/classOptions';

const NOTIFICATION_SETTINGS_KEY = 'notificationSettings';
const THREAD_ARCHIVE_KEY = 'threadArchive';
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

  async resetNotificationSettings(): Promise<void> {
    await db.settings.delete(NOTIFICATION_SETTINGS_KEY);
  },
};
