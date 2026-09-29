// src/push/classOptions.ts — the pure mapping from a message class
// (docs/protocol.md) to a notification's title and its
// registration.showNotification options: mw-f758y.5's decided defaults,
// and the only lever a plain PWA has for per-class behaviour
// (docs/research/notifications.md §1 — there is no Android-Settings-level
// channel per class without a native wrapper). Imported both by the app
// (for its unit tests and its settings screen) and by src/sw.ts's push
// handler, so the two never drift apart.
import type { MessageClass } from '../data/db';
import { formatRoute } from '../nav/route';

export interface NotificationOptions {
  vibrate?: number[];
  tag?: string;
  renotify?: boolean;
  requireInteraction?: boolean;
  silent?: boolean;
  body?: string;
  data: { txid: string; class: MessageClass; url: string };
}

export interface NotificationSpec {
  title: string;
  options: NotificationOptions;
}

// mw-1589l.8: the four switches his settings screen shows for each class.
// `quiet` is a per-class mute that overrides `sound` and `vibrate` outright
// (rather than duplicating them) — it's the one switch for "never mind what
// I said above, don't alert me for this class right now."
export interface ClassNotificationSettings {
  sound: boolean;
  vibrate: boolean;
  stayUntilDismissed: boolean;
  quiet: boolean;
}

export type NotificationSettingsMap = Record<MessageClass, ClassNotificationSettings>;

const TITLES: Record<MessageClass, string> = {
  'decision-needed': 'Decision needed',
  landing: 'Landing to verify',
  alarm: 'Alarm',
  message: 'Message',
  'move-home': 'Move home',
};

// The classes the Mayor sends him and he can be notified of; move-home only ever
// goes the other way, so it has no settings row.
export const MESSAGE_CLASSES = (Object.keys(TITLES) as MessageClass[]).filter((messageClass) => messageClass !== 'move-home');

// The vibrate pattern each class uses when its `vibrate` switch is on. Kept
// distinct from the switch itself so turning vibrate on for a class that
// defaults to it off (landing) still has a pattern to use.
const VIBRATE_PATTERNS: Record<MessageClass, number[]> = {
  'decision-needed': [200, 100, 200],
  landing: [150],
  alarm: [300, 100, 300, 100, 300],
  message: [80],
  'move-home': [80],
};

// mw-f758y.5's decided defaults, reproducing exactly the fixed behaviour this
// module had before settings existed.
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettingsMap = {
  'decision-needed': { sound: true, vibrate: true, stayUntilDismissed: true, quiet: false },
  landing: { sound: true, vibrate: false, stayUntilDismissed: false, quiet: false },
  alarm: { sound: true, vibrate: true, stayUntilDismissed: true, quiet: false },
  message: { sound: true, vibrate: true, stayUntilDismissed: false, quiet: false },
  'move-home': { sound: true, vibrate: false, stayUntilDismissed: false, quiet: false },
};

/** Builds the title and showNotification options for messageClass, tagging
 * the notification with txid so a click can name what to open. `settings`
 * (the class's stored switches, or its decided defaults) governs sound,
 * vibrate and requireInteraction; tag and renotify stay fixed per class. */
/** plans/0021: where a tap on each class's notification lands when nothing more
 * specific is known — the queue for anything that needs him, Talk for a plain
 * message. Also where the notice screen gives up to (src/cockpit/NoticeScreen.tsx). */
export const CLASS_URLS: Record<MessageClass, string> = {
  'decision-needed': '/?v=needs',
  landing: '/?v=needs',
  alarm: '/?v=needs',
  message: '/?v=talk',
  'move-home': '/?v=me',
};

export interface NotificationText {
  /** docs/api.md's optional push `title`, which replaces the class's own. */
  title?: string;
  body?: string;
  /** The push's own unix-seconds timestamp. */
  ts?: number;
}

/** mw-f758y.25: where a tap on this push lands. A push about a record names
 * only its txid (never its plaintext), so it lands on the notice screen, which
 * finds the message and moves to its thread once the app can decrypt it; a push
 * with no record behind it is the watchdog's alarm, which carries what it said
 * and lands on the alarm itself. */
function tapUrl(messageClass: MessageClass, txid: string, text: NotificationText): string {
  if (txid) return `/${formatRoute({ view: 'notice', tx: txid, cls: messageClass })}`;
  if (messageClass === 'alarm') return `/${formatRoute({ view: 'alarm', title: text.title, body: text.body, ts: text.ts })}`;
  return CLASS_URLS[messageClass] ?? '/';
}

export function notificationSpecForClass(
  messageClass: MessageClass,
  txid: string,
  settings: ClassNotificationSettings = DEFAULT_NOTIFICATION_SETTINGS[messageClass],
  text: NotificationText = {},
): NotificationSpec {
  const title = text.title || TITLES[messageClass];
  const data = { txid, class: messageClass, url: tapUrl(messageClass, txid, text) };
  const silent = settings.quiet || !settings.sound;
  const vibrate = !settings.quiet && settings.vibrate ? VIBRATE_PATTERNS[messageClass] : undefined;
  const requireInteraction = settings.stayUntilDismissed;
  const options: NotificationOptions = { data, silent, requireInteraction, ...(vibrate && { vibrate }), ...(text.body && { body: text.body }) };

  switch (messageClass) {
    case 'landing':
      return { title, options: { ...options, tag: 'landing' } };
    case 'alarm':
      return { title, options: { ...options, tag: 'alarm', renotify: true } };
    case 'decision-needed':
    case 'message':
    case 'move-home':
      return { title, options };
  }
}
