// src/services/push.ts — the 'Notify me' action (Gate.tsx): asks Notification
// permission, subscribes this browser's push manager with the backend's VAPID
// public key (GET /api/push/vapid-public-key, docs/api.md), and posts the
// resulting subscription so the backend can push to it
// (POST /api/push/subscribe).
//
// Each account subscribes with its own backend (mw-9rp4hu.23). A service worker registration holds one subscription, made with
// one VAPID key, so account 1 keeps the app's own registration and every other account has a push-only registration of its
// own (src/push/accountScope.ts); the worker running in it knows which account a push is for by its scope (src/sw.ts).
import { accountsRepo } from '../data/repositories/accounts-repo';
import { FIRST_ACCOUNT_ID } from '../data/db';
import { scopeForAccount } from '../push/accountScope';
import { apiFetch } from './apiAuth';
import { onAccountRemoved } from './accounts';

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
  /** The account to subscribe: the active one's when omitted. Its backend is called, and `unlockedKey` must be its key. */
  accountId?: string;
  /** The backend to call; the account's own when omitted. */
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/** The registration an account's pushes come through: the app's own for account 1, else a push-only one made (from the same
 * worker script) on first use. A subscription can only be made on a registration whose worker is active, so this waits for it. */
async function registrationFor(accountId: string): Promise<ServiceWorkerRegistration> {
  const main = await navigator.serviceWorker.ready;
  if (accountId === FIRST_ACCOUNT_ID) return main;
  const script = (main.active ?? main.waiting ?? main.installing)?.scriptURL;
  if (!script) throw new Error('The app is not ready to receive notifications yet. Try again in a moment.');
  const own = await navigator.serviceWorker.register(script, { scope: scopeForAccount(accountId) });
  await activated(own);
  return own;
}

/** Resolves once the registration has an active worker. */
function activated(registration: ServiceWorkerRegistration): Promise<void> {
  if (registration.active) return Promise.resolve();
  const installing = registration.installing ?? registration.waiting;
  if (!installing) return Promise.reject(new Error('Notifications could not be set up for this account.'));
  return new Promise((resolve, reject) => {
    const settle = () => {
      if (installing.state === 'activated') resolve();
      else if (installing.state === 'redundant') reject(new Error('Notifications could not be set up for this account.'));
    };
    installing.addEventListener('statechange', settle);
    settle();
  });
}

/** An account's own registration if it has one now (account 1's is the app's), without making one. */
async function existingRegistrationFor(accountId: string): Promise<ServiceWorkerRegistration | undefined> {
  if (accountId === FIRST_ACCOUNT_ID) return navigator.serviceWorker.getRegistration();
  const path = scopeForAccount(accountId);
  return (await navigator.serviceWorker.getRegistrations()).find((registration) => new URL(registration.scope).pathname === path);
}

/**
 * Asks for notification permission, subscribes this browser's push manager
 * with the backend's VAPID key, and posts the subscription so the backend
 * can push to it. Throws if permission is denied, or if either request
 * fails — the caller shows that as an error, same as syncMessages.
 */
export async function subscribeToPush(params: SubscribeToPushParams): Promise<void> {
  // Pinned up front: a switch of account while the permission prompt is open does not move this to the other one.
  const accountId = params.accountId ?? accountsRepo.activeNow().id;
  const account = (await accountsRepo.list()).find((candidate) => candidate.id === accountId);
  if (!account && params.accountId !== undefined && params.apiBase === undefined) throw new Error(`There is no account ${accountId}.`);
  const apiOptions = { unlockedKey: params.unlockedKey, apiBase: params.apiBase ?? account?.backendUrl, fetchImpl: params.fetchImpl };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  const keyResponse = await apiFetch('/push/vapid-public-key', undefined, apiOptions);
  if (!keyResponse.ok) throw new Error(`Could not fetch the VAPID public key (${keyResponse.status}).`);
  const { publicKey } = (await keyResponse.json()) as { publicKey: string };

  const registration = await registrationFor(accountId);
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

/** Whether this browser already holds a push subscription for the account (the active one's when none is named)
 * (plans/0021: the old "Notify me" button looked active again after every reload). */
export async function isPushSubscribed(accountId: string = accountsRepo.activeNow().id): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || typeof Notification === 'undefined') return false;
  if (Notification.permission !== 'granted') return false;
  try {
    const registration = await existingRegistrationFor(accountId);
    return (await registration?.pushManager.getSubscription()) != null;
  } catch {
    return false;
  }
}

/** Takes an account's push subscription down: the subscription is cancelled with the push service (which then answers its
 * backend's next push with 410, and the backend drops it, docs/api.md), and a push-only registration is dropped with it. */
export async function unsubscribeFromPush(accountId: string): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const registration = await existingRegistrationFor(accountId);
  if (!registration) return;
  await (await registration.pushManager.getSubscription())?.unsubscribe();
  if (accountId !== FIRST_ACCOUNT_ID) await registration.unregister();
}

// A removed account is no longer pushed to.
onAccountRemoved((id) => {
  void unsubscribeFromPush(id).catch(() => undefined);
});

export async function rememberPushSubscribed(): Promise<void> {
  const { settingsRepo } = await import('../data/repositories');
  await settingsRepo.set(SUBSCRIBED_SETTING, Date.now());
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
}
