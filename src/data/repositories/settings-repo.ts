import { db } from '../db';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../../push/classOptions';
import type { NotificationSettingsMap } from '../../push/classOptions';

const NOTIFICATION_SETTINGS_KEY = 'notificationSettings';

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

  async resetNotificationSettings(): Promise<void> {
    await db.settings.delete(NOTIFICATION_SETTINGS_KEY);
  },
};
