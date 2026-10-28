// src/push/accountScope.ts — which account a push registration belongs to (mw-9rp4hu.23). A push event does not say which
// backend sent it, and a registration holds one subscription, made with one backend's VAPID key; so account 1 keeps the app's
// own registration (scope /) and every other account gets a push-only registration of its own, at a scope no page ever lands
// on. The worker running in a registration reads its account off that registration's scope.
import { FIRST_ACCOUNT_ID } from '../data/db';

const PREFIX = '/push-account/';

/** The scope (a path on this origin) of the registration an account's pushes arrive through. */
export function scopeForAccount(accountId: string): string {
  return accountId === FIRST_ACCOUNT_ID ? '/' : `${PREFIX}${encodeURIComponent(accountId)}/`;
}

/** The account a registration of this scope (a full URL, as `registration.scope` gives it) belongs to: account 1 for the app's own. */
export function accountForScope(scope: string | undefined): string {
  if (!scope) return FIRST_ACCOUNT_ID;
  try {
    const path = new URL(scope).pathname;
    if (!path.startsWith(PREFIX)) return FIRST_ACCOUNT_ID;
    const id = decodeURIComponent(path.slice(PREFIX.length).replace(/\/$/, ''));
    return id === '' || id.includes('/') ? FIRST_ACCOUNT_ID : id;
  } catch {
    return FIRST_ACCOUNT_ID;
  }
}
