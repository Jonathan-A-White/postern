// src/services/push.ts — the 'Notify me' action (Gate.tsx): asks Notification
// permission, subscribes this browser's push manager with the backend's VAPID
// public key (GET /api/push/vapid-public-key, docs/api.md), and posts the
// resulting subscription so the backend can push to it
// (POST /api/push/subscribe).
import { API_BASE } from './messages';

function base64UrlToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export interface SubscribeToPushParams {
  /** This phone's own public key (hex) — the vault row's publicKeyHex, the
   * `to` a pushed record's payload must name for this subscription to fire. */
  publicKeyHex: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Asks for notification permission, subscribes this browser's push manager
 * with the backend's VAPID key, and posts the subscription so the backend
 * can push to it. Throws if permission is denied, or if either request
 * fails — the caller shows that as an error, same as syncMessages.
 */
export async function subscribeToPush(params: SubscribeToPushParams): Promise<void> {
  const apiBase = params.apiBase ?? API_BASE;
  const fetchImpl = params.fetchImpl ?? fetch;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  const keyResponse = await fetchImpl(`${apiBase}/push/vapid-public-key`);
  if (!keyResponse.ok) throw new Error(`Could not fetch the VAPID public key (${keyResponse.status}).`);
  const { publicKey } = (await keyResponse.json()) as { publicKey: string };

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(publicKey),
  });

  const subscribeResponse = await fetchImpl(`${apiBase}/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pubkey: params.publicKeyHex, subscription: subscription.toJSON() }),
  });
  if (!subscribeResponse.ok) throw new Error(`Could not register for push (${subscribeResponse.status}).`);
}
