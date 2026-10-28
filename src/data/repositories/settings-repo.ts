import { accountDb, db, type ArchiveChoices, type PromptsCache } from '../db';
import { accountsRepo } from './accounts-repo';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../../push/classOptions';
import type { NotificationSettingsMap } from '../../push/classOptions';
import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from '../../push/reminder';
import type { IdeasOnlyKept } from '../../model/ideasOnly';

const NOTIFICATION_SETTINGS_KEY = 'notificationSettings';
const REMINDER_SETTINGS_KEY = 'reminderSettings';
const THREAD_ARCHIVE_KEY = 'threadArchive';
const PENDING_LATERS_KEY = 'pendingLaters';
const ANSWERED_RING_KEY = 'answeredRing';
const PROMPTS_KEY = 'prompts';
const RECORDED_NOTES_KEY = 'recordedNotes';
/** How many notes are kept: the newest ones; they are history, not a record. */
const RECORDED_NOTES_KEPT = 500;
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

  /** The Reminders setting (src/push/reminder.ts), kept apart from the per-class switches: read by the Me screen and by src/sw.ts's push handler. */
  async getReminderSettings(): Promise<ReminderSettings> {
    const row = await db.settings.get(REMINDER_SETTINGS_KEY);
    return { ...DEFAULT_REMINDER_SETTINGS, ...(row?.value as Partial<ReminderSettings> | undefined) };
  },

  async setReminderSettings(settings: ReminderSettings): Promise<void> {
    await db.settings.put({ key: REMINDER_SETTINGS_KEY, value: settings });
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

  /** A Later tap with no open window to send it: kept for the next open (src/sw.ts), once per ring. It is kept in the
   * account's own store when one is named (a tap for an account that is not the one on screen), else in the active one's. */
  async addPendingLater(ringTxid: string, accountId?: string): Promise<void> {
    const store = accountId === undefined ? db : accountDb(accountId);
    await store.transaction('rw', store.settings, async () => {
      const row = await store.settings.get(PENDING_LATERS_KEY);
      const waiting = (row?.value as string[] | undefined) ?? [];
      if (!waiting.includes(ringTxid)) await store.settings.put({ key: PENDING_LATERS_KEY, value: [...waiting, ringTxid] });
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

  /** Ideas only as the backend last answered for the active account's key, with the time (src/services/ideasOnly.ts); kept on the account (accounts-repo.ts). */
  async getIdeasOnly(): Promise<IdeasOnlyKept | undefined> {
    return (await accountsRepo.active()).ideasOnly;
  },

  async setIdeasOnly(kept: IdeasOnlyKept): Promise<void> {
    await accountsRepo.updateActive({ ideasOnly: kept });
  },

  /** The 'Recorded for after 21:00' notes of his sent messages, by their txid (a record is never changed to carry one). */
  async getRecordedNotes(): Promise<Record<string, string>> {
    const row = await db.settings.get(RECORDED_NOTES_KEY);
    return (row?.value as Record<string, string> | undefined) ?? {};
  },

  async addRecordedNote(txid: string, note: string): Promise<void> {
    await db.transaction('rw', db.settings, async () => {
      const row = await db.settings.get(RECORDED_NOTES_KEY);
      const notes = { ...((row?.value as Record<string, string> | undefined) ?? {}), [txid]: note };
      const keep = Object.entries(notes).slice(-RECORDED_NOTES_KEPT);
      await db.settings.put({ key: RECORDED_NOTES_KEY, value: Object.fromEntries(keep) });
    });
  },

  async resetNotificationSettings(): Promise<void> {
    await db.settings.delete(NOTIFICATION_SETTINGS_KEY);
  },
};
