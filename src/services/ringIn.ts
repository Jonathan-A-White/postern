// src/services/ringIn.ts — a ring the phone read off the chain itself rings in the app
// (docs/protocol.md §21), for the time the backend could not push it: the ring notification
// through the registered service worker when notifications are allowed, else a banner with the
// ring's vibration. The ring's reason is read locally here, so it can be shown; a ring sent on
// chain never carried it in a push.
import { useSyncExternalStore } from 'react';
import type { MessageRow } from '../data/db';
import { notificationSpecForRing, RING_VIBRATE } from '../push/classOptions';
import { decodeCall } from './call';

/** A ring read this long after it was sent is a missed call, not a ring: it is kept for the Talk line and does not ring. */
export const RING_FRESH_SECONDS = 600;

export interface IncomingRing {
  txid: string;
  reason: string;
}

/** The newly kept rows that should ring now: received rings sent within RING_FRESH_SECONDS of `nowSeconds`. */
export function freshRings(rows: MessageRow[], nowSeconds: number): IncomingRing[] {
  const rings: IncomingRing[] = [];
  for (const row of rows) {
    if (row.class !== 'call' || row.direction !== 'received') continue;
    const call = decodeCall(row.plaintext);
    if (call?.role === 'ring' && nowSeconds - call.at <= RING_FRESH_SECONDS) rings.push({ txid: row.txid, reason: call.text });
  }
  return rings;
}

let incoming: IncomingRing | undefined;
const listeners = new Set<() => void>();

function set(next: IncomingRing | undefined): void {
  incoming = next;
  for (const listener of listeners) listener();
}

export function getIncomingRing(): IncomingRing | undefined {
  return incoming;
}

export function dismissIncomingRing(): void {
  if (incoming) set(undefined);
}

export function useIncomingRing(): IncomingRing | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getIncomingRing,
    getIncomingRing,
  );
}

/** Shows the ring through the registered service worker, if notifications are allowed and it will. */
async function showNotification(ring: IncomingRing): Promise<boolean> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return false;
    const spec = notificationSpecForRing(ring.txid, { body: ring.reason });
    await registration.showNotification(spec.title, spec.options);
    return true;
  } catch {
    return false;
  }
}

/** Rings: the notification when it can, otherwise a banner and the ring's vibration. Says which. */
export async function ringInApp(ring: IncomingRing): Promise<'notification' | 'banner'> {
  if (await showNotification(ring)) return 'notification';
  set(ring);
  if (typeof navigator !== 'undefined') navigator.vibrate?.(RING_VIBRATE);
  return 'banner';
}
