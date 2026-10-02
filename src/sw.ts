/// <reference lib="webworker" />
// src/sw.ts — the service worker, built by vite-plugin-pwa's injectManifest
// strategy (vite.config.ts) so it can import the same TypeScript modules the
// app uses. Three jobs (plans/0021):
//  - a push shows a notification per docs/protocol.md's `class`
//    (src/push/classOptions.ts) with his per-class switches, using the push's
//    own title and body when the backend sends them (docs/api.md);
//  - ...unless a focused, visible window already shows that message's channel or
//    thread (it is asked, and has 3 s to say so), and a notification is closed once
//    the app has shown its message (mw-gq6.166);
//  - a tap lands at what the push is about (the bead's thread for a message or a
//    decision, the alarm itself for a watchdog alarm; src/push/tapTarget.ts), in
//    the open app if there is one;
//  - the Mayor's ring (class call, docs/protocol.md §21) rings like an incoming call:
//    Answer opens the Talk line, Later leaves a missed call on it (src/push/classOptions.ts);
//  - the Mayor's talk answer (class talk, docs/protocol.md §20) is pushed with no words in it: the
//    notification says only that the Mayor answered, unless a window already shows the app, and a tap opens the Talk line;
//  - an emergency events record (class events, docs/protocol.md §22) is pushed too, at once and until
//    dealt with (src/push/classOptions.ts); the app's banner shows what it was;
//  - files shared from another app (the manifest's share_target) are parked in
//    IndexedDB and the app opens on the Share screen to place them.
import { precacheAndRoute } from 'workbox-precaching';
import { notificationSpecForClass, notificationSpecForEmergency, notificationSpecForRing, notificationSpecForTalkAnswer, type PushClass } from './push/classOptions';
import { resolveTapUrl, type TapData } from './push/tapTarget';
import { settingsRepo } from './data/repositories/settings-repo';
import { sharesRepo } from './data/repositories/view-repo';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

interface PushPayload {
  class: PushClass | 'call' | 'events' | 'talk';
  txid?: string;
  ts: number;
  title?: string;
  body?: string;
}

export const SHARE_TARGET_PATH = '/share-target';

/** How long a focused window has to say whether a pushed message is already on its screen. */
const SEEN_WAIT_MS = 3000;

interface SeenMessage {
  type?: string;
  txid?: string;
  seen?: boolean;
}

/** Callers waiting for a window's answer to their 'seen?'. */
const seenWaiters = new Set<(message: SeenMessage) => void>();

function isShowingTheApp(client: Client): boolean {
  const page = client as WindowClient;
  return page.focused === true && page.visibilityState === 'visible';
}

/** Asks these windows whether the message `txid` is on their screen; no answer in
 * SEEN_WAIT_MS, or only 'no' answers, is false. */
function askWhetherSeen(clients: readonly Client[], txid: string): Promise<boolean> {
  return new Promise((resolve) => {
    let noes = 0;
    const finish = (seen: boolean) => {
      clearTimeout(timer);
      seenWaiters.delete(waiter);
      resolve(seen);
    };
    const waiter = (message: SeenMessage) => {
      if (message.txid !== txid) return;
      if (message.seen !== false) finish(true);
      else if (++noes >= clients.length) finish(false);
    };
    const timer = setTimeout(() => finish(false), SEEN_WAIT_MS);
    seenWaiters.add(waiter);
    for (const client of clients) client.postMessage({ type: 'seen?', txid });
  });
}

/** Closes the notifications of the message `txid`, whatever their tag. */
async function closeNotificationsFor(txid: string): Promise<void> {
  for (const notification of await self.registration.getNotifications()) {
    if ((notification.data as TapData | undefined)?.txid === txid) notification.close();
  }
}

async function onPush(payload: PushPayload): Promise<void> {
  // A ring is a call, not a message on a screen: it always rings, whatever window is open.
  if (payload.class === 'call') {
    const ring = notificationSpecForRing(payload.txid ?? '', { title: payload.title, body: payload.body });
    await self.registration.showNotification(ring.title, ring.options);
    return;
  }
  // An emergency events record (§22) shows at once: the banner in an open app comes from the record, not from this push.
  if (payload.class === 'events') {
    const emergency = notificationSpecForEmergency(payload.txid ?? '', { title: payload.title });
    await self.registration.showNotification(emergency.title, emergency.options);
    return;
  }
  // The Mayor's talk answer (§20), pushed with no words: a page the browser has frozen cannot show
  // this itself. A window he is looking at speaks the answer already, so only then is it not shown.
  if (payload.class === 'talk') {
    const showing = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(isShowingTheApp);
    if (showing.length > 0) return;
    const answered = notificationSpecForTalkAnswer();
    await self.registration.showNotification(answered.title, answered.options);
    return;
  }
  // A message already on a window he is looking at needs no notification, whatever its class.
  if (payload.txid) {
    const showing = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(isShowingTheApp);
    if (showing.length > 0 && (await askWhetherSeen(showing, payload.txid))) {
      for (const client of showing) client.postMessage({ type: 'sync-inbox' });
      return;
    }
  }
  const settings = await settingsRepo.getNotificationSettings();
  const spec = notificationSpecForClass(payload.class, payload.txid ?? '', settings[payload.class], { title: payload.title, body: payload.body, ts: payload.ts });
  await self.registration.showNotification(spec.title, spec.options);
}

self.addEventListener('push', (event) => {
  if (!event.data) return;
  event.waitUntil(onPush(event.data.json() as PushPayload));
});

// The app answers a 'seen?' with {type:'seen', txid, seen}, and tells the worker
// {type:'seen', txid} when it has shown a message: that one closes its notification.
self.addEventListener('message', (event) => {
  const data = event.data as SeenMessage | undefined;
  if (data?.type !== 'seen' || !data.txid) return;
  for (const waiter of [...seenWaiters]) waiter(data);
  if (data.seen !== false) event.waitUntil(closeNotificationsFor(data.txid));
});

/** Focuses an open window and sends it to `url`, or opens one there. */
async function openAt(url: string): Promise<WindowClient | null | undefined> {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientList) {
    if ('focus' in client) {
      client.postMessage({ type: 'sync-inbox' });
      client.postMessage({ type: 'open', url });
      return client.focus();
    }
  }
  return self.clients.openWindow(url);
}

/** His Later tap on a ring: an open window sends the record (the key is in the app); with none, the tap waits in IndexedDB for the next open. */
async function putRingOff(ringTxid: string): Promise<void> {
  const [open] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (open) open.postMessage({ type: 'later', ring_txid: ringTxid });
  else await settingsRepo.addPendingLater(ringTxid);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data as TapData | undefined;
  if (data?.class === 'call' && event.action === 'later') {
    if (data.txid) event.waitUntil(putRingOff(data.txid));
    return;
  }
  // Answer, or a tap on the ring itself, opens the Talk line with the ring named; no thread is looked up for it.
  // An emergency opens the app at its own url, where the banner waits.
  const ringUrl = data?.class === 'call' || data?.class === 'events' || data?.class === 'talk' ? data.url : undefined;
  event.waitUntil(ringUrl ? openAt(ringUrl) : resolveTapUrl(data).then(openAt));
});

async function parkShare(request: Request): Promise<Response> {
  const form = await request.formData();
  const files = await Promise.all(
    form
      .getAll('files')
      .filter((entry): entry is File => typeof entry !== 'string')
      .map(async (file) => ({ name: file.name, type: file.type, bytes: await file.arrayBuffer() })),
  );
  const text = ['title', 'text', 'url']
    .map((field) => form.get(field))
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .join('\n');
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await sharesRepo.put({ id, createdAt: Date.now(), text: text || undefined, files });
  return Response.redirect(`/?v=share&s=${encodeURIComponent(id)}`, 303);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname === SHARE_TARGET_PATH) {
    event.respondWith(parkShare(event.request));
  }
});
