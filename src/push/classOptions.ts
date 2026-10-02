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
  /** Buttons on the notification (the Mayor's ring: Answer and Later). */
  actions?: { action: string; title: string }[];
  data: { txid: string; class: PushClass | 'call' | 'events' | 'talk'; url: string };
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

/** The classes that can reach him as a push: every class but `talk`, whose answer has its own notification (notificationSpecForTalkAnswer, §20), `call`, whose ring has its own notification (notificationSpecForRing, §21), and `events`, whose emergency has its own notification (notificationSpecForEmergency, §22). */
export type PushClass = Exclude<MessageClass, 'talk' | 'call' | 'events' | 'card' | 'card-update'>;

export type NotificationSettingsMap = Record<PushClass, ClassNotificationSettings>;

const TITLES: Record<PushClass, string> = {
  'decision-needed': 'Decision needed',
  landing: 'Landing to verify',
  alarm: 'Alarm',
  message: 'Message',
  'move-home': 'Move home',
};

// The classes the Mayor sends him and he can be notified of; move-home only ever
// goes the other way, so it has no settings row.
export const MESSAGE_CLASSES = (Object.keys(TITLES) as PushClass[]).filter((messageClass) => messageClass !== 'move-home');

// The vibrate pattern each class uses when its `vibrate` switch is on. Kept
// distinct from the switch itself so turning vibrate on for a class that
// defaults to it off (landing) still has a pattern to use.
const VIBRATE_PATTERNS: Record<PushClass, number[]> = {
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
  talk: '/?v=talk',
  call: '/?v=line',
  events: '/?v=needs',
  card: '/?v=needs',
  'card-update': '/?v=needs',
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
function tapUrl(messageClass: PushClass, txid: string, text: NotificationText): string {
  if (txid) return `/${formatRoute({ view: 'notice', tx: txid, cls: messageClass })}`;
  if (messageClass === 'alarm') return `/${formatRoute({ view: 'alarm', title: text.title, body: text.body, ts: text.ts })}`;
  return CLASS_URLS[messageClass] ?? '/';
}

/** The tag every ring wears, so a second ring replaces the first and re-alerts. */
export const RING_TAG = 'mayor-call';

export const RING_TITLE = 'The Mayor is calling';

/** The ring's vibration: ten pulses of 600 ms, 400 ms apart. A Web Notification cannot loop
 * forever, so this is the longest, most phone-like pattern the notification asks for once; the
 * phone's own ring, vibrate or silent mode decides whether it plays (the app sets no volume). */
export const RING_VIBRATE: number[] = Array.from({ length: 10 }, () => [600, 400]).flat();

/** Where a tap on a ring (Answer, or the notification itself) lands: the Talk line, naming the ring. */
export function ringTapUrl(txid: string): string {
  return `/${formatRoute({ view: 'line', call: txid })}`;
}

/** The notification for the Mayor's ring (docs/protocol.md §21): it rings like an incoming call,
 * Answer and Later, until dealt with. `body` is the reason the push carries, if any. It follows
 * no per-class switch: it is never silent, and Android applies the phone's ring/vibrate/silent mode. */
export function notificationSpecForRing(txid: string, text: { title?: string; body?: string } = {}): NotificationSpec {
  return {
    title: text.title || RING_TITLE,
    options: {
      tag: RING_TAG,
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: RING_VIBRATE,
      actions: [
        { action: 'answer', title: 'Answer' },
        { action: 'later', title: 'Later' },
      ],
      data: { txid, class: 'call', url: ringTapUrl(txid) },
      ...(text.body && { body: text.body }),
    },
  };
}

/** The tag a talk answer's notification wears, so a second one replaces the first. */
export const TALK_ANSWER_TAG = 'talk-answer';

export const TALK_ANSWER_TITLE = 'The Mayor answered';

/** The chime's buzz (src/services/chime.ts), for the notification to match. */
export const TALK_ANSWER_VIBRATE = [120];

/** The notification the Talk line shows when an answer comes while he has left the app (mw-j0f2d.29):
 * the title and nothing else, because the answer's words stay sealed until he is back, and the
 * answer is spoken then. It is never silent; a tap opens the Talk line, where the answer speaks. */
export function notificationSpecForTalkAnswer(): NotificationSpec {
  return {
    title: TALK_ANSWER_TITLE,
    options: {
      tag: TALK_ANSWER_TAG,
      renotify: true,
      silent: false,
      vibrate: TALK_ANSWER_VIBRATE,
      data: { txid: '', class: 'talk', url: `/${formatRoute({ view: 'line' })}` },
    },
  };
}

/** The tag every emergency wears, so a second one replaces the first and re-alerts. */
export const EMERGENCY_TAG = 'emergency';

export const EMERGENCY_TITLE = 'Emergency';

/** The emergency's vibration: three long pulses, like an alarm's. */
const EMERGENCY_VIBRATE = [500, 150, 500, 150, 500];

/** The notification for an emergency events record (docs/protocol.md §22): the push carries the lane and
 * nothing of the record (its words are sealed), so it names no detail; the banner in the app, which
 * has read the record, shows it. It follows no per-class switch: it is never silent, and it stays
 * until he deals with it. A tap opens the app, where the banner waits. */
export function notificationSpecForEmergency(txid: string, text: { title?: string } = {}): NotificationSpec {
  return {
    title: text.title || EMERGENCY_TITLE,
    options: {
      tag: EMERGENCY_TAG,
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: EMERGENCY_VIBRATE,
      data: { txid, class: 'events', url: CLASS_URLS.events },
    },
  };
}

export function notificationSpecForClass(
  messageClass: PushClass,
  txid: string,
  settings: ClassNotificationSettings = DEFAULT_NOTIFICATION_SETTINGS[messageClass],
  text: NotificationText = {},
): NotificationSpec {
  const title = text.title || TITLES[messageClass];
  const data = { txid, class: messageClass, url: tapUrl(messageClass, txid, text) };
  // The Notifications API's `silent` mutes the vibration as well as the sound, so
  // a class with Vibrate on must not be silent whatever Sound says (mw-t64a3.20).
  const silent = settings.quiet || (!settings.sound && !settings.vibrate);
  const vibrate = !settings.quiet && settings.vibrate ? VIBRATE_PATTERNS[messageClass] : undefined;
  const requireInteraction = settings.stayUntilDismissed;
  const options: NotificationOptions = { data, silent, requireInteraction, ...(vibrate && { vibrate }), ...(text.body && { body: text.body }) };

  switch (messageClass) {
    case 'landing':
      return { title, options: { ...options, tag: 'landing' } };
    case 'alarm':
      return { title, options: { ...options, tag: 'alarm', renotify: true } };
    // Tagged with its txid, so the app can close it once it has shown that message (mw-gq6.166).
    case 'decision-needed':
    case 'message':
    case 'move-home':
      return { title, options: txid ? { ...options, tag: txid } : options };
  }
}
