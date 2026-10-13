// src/push/reminder.ts — the Reminders setting and a reminder push's notification (mw-ev7oyy.9). A reminder
// is a To do card whose due time has come. A plain PWA has no channel of its own for one kind of push (Android
// gives the origin one: docs/research/notifications.md §1), so Reminders is a setting of this app, apart from
// the per-class switches of classOptions.ts, and src/sw.ts reads it for every `reminder` push: sound and buzz
// on or off, and quiet hours in which a reminder still shows but silently. Imported by the worker, the Me
// screen and the tests, so they never drift apart.
import { formatRoute } from '../nav/route';
import type { NotificationSpec, NotificationText } from './classOptions';

export interface ReminderSettings {
  /** Sound and buzz: off shows every reminder silently. */
  sound: boolean;
  /** Inside quiet hours a reminder shows silently, whatever Sound says. */
  quietHours: boolean;
  /** 'HH:MM' in the phone's zone; an end before the start runs past midnight. */
  quietFrom: string;
  quietTo: string;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { sound: true, quietHours: false, quietFrom: '22:00', quietTo: '07:00' };

export const REMINDER_TITLE = 'Reminder';

/** The buzz of an audible reminder. */
const REMINDER_VIBRATE = [200, 100, 200];

/** Where a tap on a reminder lands: the To do board. */
export const REMINDER_URL = `/${formatRoute({ view: 'todo' })}`;

/** Minutes after midnight of an 'HH:MM' value, or undefined when it is none. */
function minutesOf(time: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return undefined;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[1]) < 24 && Number(match[2]) < 60 ? minutes : undefined;
}

/** True when quiet hours are on and `at` (the phone's clock) is from their start up to, not including, their end. */
export function inQuietHours(settings: ReminderSettings, at: Date): boolean {
  if (!settings.quietHours) return false;
  const from = minutesOf(settings.quietFrom);
  const to = minutesOf(settings.quietTo);
  if (from === undefined || to === undefined || from === to) return false;
  const now = at.getHours() * 60 + at.getMinutes();
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/** The notification for a reminder push, shown at `now`: it stays until dealt with, sounds and buzzes unless Sound is off or
 * it is quiet hours, and a tap opens the To do board. */
export function notificationSpecForReminder(txid: string, settings: ReminderSettings, now: Date, text: NotificationText = {}): NotificationSpec {
  const silent = !settings.sound || inQuietHours(settings, now);
  return {
    title: text.title || REMINDER_TITLE,
    options: {
      tag: txid ? `reminder-${txid}` : 'reminder',
      silent,
      requireInteraction: true,
      ...(!silent && { vibrate: REMINDER_VIBRATE }),
      ...(text.body && { body: text.body }),
      data: { txid, class: 'reminder', url: REMINDER_URL },
    },
  };
}
