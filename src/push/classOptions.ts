// src/push/classOptions.ts — the pure mapping from a message class
// (docs/protocol.md) to a notification's title and its
// registration.showNotification options: mw-f758y.5's decided defaults,
// and the only lever a plain PWA has for per-class behaviour
// (docs/research/notifications.md §1 — there is no Android-Settings-level
// channel per class without a native wrapper). Imported both by the app
// (for its unit tests) and by src/sw.ts's push handler, so the two never
// drift apart.
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

const TITLES: Record<MessageClass, string> = {
  'decision-needed': 'Decision needed',
  landing: 'Landing to verify',
  alarm: 'Alarm',
  message: 'Message',
};

/** Builds the title and showNotification options for messageClass, tagging
 * the notification with txid so a click can name what to open. */
export function notificationSpecForClass(messageClass: MessageClass, txid: string): NotificationSpec {
  const title = TITLES[messageClass];
  const data = { txid };

  switch (messageClass) {
    case 'decision-needed':
      return { title, options: { vibrate: [200, 100, 200], requireInteraction: true, data } };
    case 'landing':
      return { title, options: { tag: 'landing', data } };
    case 'alarm':
      return { title, options: { vibrate: [300, 100, 300, 100, 300], requireInteraction: true, tag: 'alarm', renotify: true, data } };
    case 'message':
      return { title, options: { vibrate: [80], data } };
  }
}
