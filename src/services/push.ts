// src/services/push.ts — the 'Notify me' action (Gate.tsx): asks Notification
// permission, subscribes this browser's push manager with the backend's VAPID
// public key (GET /api/push/vapid-public-key, docs/api.md), and posts the
// resulting subscription so the backend can push to it
// (POST /api/push/subscribe).
import { apiFetch } from './apiAuth';

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
  /** This phone's unlocked raw master key, when a session key is cached — signs
   * the proof docs/api.md's Authentication requires on every /api call. */
  unlockedKey?: Uint8Array;
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
  const apiOptions = { unlockedKey: params.unlockedKey, apiBase: params.apiBase, fetchImpl: params.fetchImpl };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  const keyResponse = await apiFetch('/push/vapid-public-key', undefined, apiOptions);
  if (!keyResponse.ok) throw new Error(`Could not fetch the VAPID public key (${keyResponse.status}).`);
  const { publicKey } = (await keyResponse.json()) as { publicKey: string };

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(publicKey),
  });

  const subscribeResponse = await apiFetch(
    '/push/subscribe',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pubkey: params.publicKeyHex, subscription: subscription.toJSON() }),
    },
    apiOptions,
  );
  if (!subscribeResponse.ok) throw new Error(`Could not register for push (${subscribeResponse.status}).`);
}

const SUBSCRIBED_SETTING = 'push-subscribed-at';

/** Whether this browser already holds a push subscription (plans/0021: the old
 * "Notify me" button looked active again after every reload). */
export async function isPushSubscribed(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || typeof Notification === 'undefined') return false;
  if (Notification.permission !== 'granted') return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager.getSubscription()) != null;
  } catch {
    return false;
  }
}

export async function rememberPushSubscribed(): Promise<void> {
  const { settingsRepo } = await import('../data/repositories');
  await settingsRepo.set(SUBSCRIBED_SETTING, Date.now());
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
}
