// src/push/classOptions.ts — the pure mapping from a message class
// (docs/protocol.md) to a notification's title and its
// registration.showNotification options: mw-f758y.5's decided defaults,
// and the only lever a plain PWA has for per-class behaviour
// (docs/research/notifications.md §1 — there is no Android-Settings-level
// channel per class without a native wrapper). Imported both by the app
// (for its unit tests and its settings screen) and by src/sw.ts's push
// handler, so the two never drift apart.
import type { MessageClass } from '../data/db';

export interface NotificationOptions {
  vibrate?: number[];
  tag?: string;
  renotify?: boolean;
  requireInteraction?: boolean;
  silent?: boolean;
  data: { txid: string };
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
};

export const MESSAGE_CLASSES = Object.keys(TITLES) as MessageClass[];

// The vibrate pattern each class uses when its `vibrate` switch is on. Kept
// distinct from the switch itself so turning vibrate on for a class that
// defaults to it off (landing) still has a pattern to use.
const VIBRATE_PATTERNS: Record<MessageClass, number[]> = {
  'decision-needed': [200, 100, 200],
  landing: [150],
  alarm: [300, 100, 300, 100, 300],
  message: [80],
};

// mw-f758y.5's decided defaults, reproducing exactly the fixed behaviour this
// module had before settings existed.
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettingsMap = {
  'decision-needed': { sound: true, vibrate: true, stayUntilDismissed: true, quiet: false },
  landing: { sound: true, vibrate: false, stayUntilDismissed: false, quiet: false },
  alarm: { sound: true, vibrate: true, stayUntilDismissed: true, quiet: false },
  message: { sound: true, vibrate: true, stayUntilDismissed: false, quiet: false },
};

/** Builds the title and showNotification options for messageClass, tagging
 * the notification with txid so a click can name what to open. `settings`
 * (the class's stored switches, or its decided defaults) governs sound,
 * vibrate and requireInteraction; tag and renotify stay fixed per class. */
export function notificationSpecForClass(
  messageClass: MessageClass,
  txid: string,
  settings: ClassNotificationSettings = DEFAULT_NOTIFICATION_SETTINGS[messageClass],
): NotificationSpec {
  const title = TITLES[messageClass];
  const data = { txid };
  const silent = settings.quiet || !settings.sound;
  const vibrate = !settings.quiet && settings.vibrate ? VIBRATE_PATTERNS[messageClass] : undefined;
  const requireInteraction = settings.stayUntilDismissed;
  const options: NotificationOptions = { data, silent, requireInteraction, ...(vibrate && { vibrate }) };

  switch (messageClass) {
    case 'landing':
      return { title, options: { ...options, tag: 'landing' } };
    case 'alarm':
      return { title, options: { ...options, tag: 'alarm', renotify: true } };
    case 'decision-needed':
    case 'message':
      return { title, options };
  }
}
