/// <reference lib="webworker" />
// src/sw.ts — the service worker, built by vite-plugin-pwa's injectManifest
// strategy (vite.config.ts) so it can import the same TypeScript modules the
// app uses. Three jobs (plans/0021):
//  - a push shows a notification per docs/protocol.md's `class`
//    (src/push/classOptions.ts) with his per-class switches, using the push's
//    own title and body when the backend sends them (docs/api.md);
//  - a tap lands at what the push is about (the bead's thread for a message or a
//    decision, the alarm itself for a watchdog alarm; src/push/tapTarget.ts), in
//    the open app if there is one;
//  - files shared from another app (the manifest's share_target) are parked in
//    IndexedDB and the app opens on the Share screen to place them.
import { precacheAndRoute } from 'workbox-precaching';
import { notificationSpecForClass } from './push/classOptions';
import { resolveTapUrl, type TapData } from './push/tapTarget';
import { settingsRepo } from './data/repositories/settings-repo';
import { sharesRepo } from './data/repositories/view-repo';
import type { MessageClass } from './data/db';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

interface PushPayload {
  class: MessageClass;
  txid?: string;
  ts: number;
  title?: string;
  body?: string;
}

export const SHARE_TARGET_PATH = '/share-target';

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const payload = event.data.json() as PushPayload;
  event.waitUntil(
    settingsRepo.getNotificationSettings().then((settings) => {
      const spec = notificationSpecForClass(payload.class, payload.txid ?? '', settings[payload.class], { title: payload.title, body: payload.body, ts: payload.ts });
      return self.registration.showNotification(spec.title, spec.options);
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data as TapData | undefined;
  event.waitUntil(
    Promise.all([resolveTapUrl(data), self.clients.matchAll({ type: 'window', includeUncontrolled: true })]).then(([url, clientList]) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'sync-inbox' });
          client.postMessage({ type: 'open', url });
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
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
