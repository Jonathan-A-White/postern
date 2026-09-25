/// <reference lib="webworker" />
// src/sw.ts — the service worker, built by vite-plugin-pwa's injectManifest
// strategy (vite.config.ts) so it can import the same TypeScript modules the
// app uses, rather than duplicating them in a hand-written plain-JS worker.
// Its push handler shows a notification per docs/protocol.md's `class`
// (src/push/classOptions.ts); a click focuses (or opens) the inbox and asks
// it to resync, since a service worker never runs the app's own React code.
import { precacheAndRoute } from 'workbox-precaching';
import { notificationSpecForClass } from './push/classOptions';
import type { MessageClass } from './data/db';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

interface PushPayload {
  class: MessageClass;
  txid: string;
  ts: number;
}

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const payload = event.data.json() as PushPayload;
  const spec = notificationSpecForClass(payload.class, payload.txid);
  event.waitUntil(self.registration.showNotification(spec.title, spec.options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'sync-inbox' });
          return client.focus();
        }
      }
      return self.clients.openWindow('/?screen=inbox');
    }),
  );
});
