// src/services/accounts.ts — the accounts this app keeps and which one is active (mw-9rp4hu.4). The client
// (apiAuth.ts), the unlocked key (keySession.ts), the licence (licence.ts), Ideas only and every store (db.ts)
// are the active account's, so a screen asks for none of them by account. There is no screen to add or switch yet.
import { accountsRepo, DEFAULT_BACKEND_URL, DEFAULT_KEY_REF, type Account } from '../data/repositories';
import { FIRST_ACCOUNT_ID } from '../data/db';

export type { Account };
export { FIRST_ACCOUNT_ID };

const listeners = new Set<() => void>();

/** Called after the active account changes, for the app to re-render and the live stream to reconnect. */
export function onAccountChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** On launch: makes the stored active account (account 1 on an older phone) the one in use. */
export async function loadAccounts(): Promise<Account> {
  const account = await accountsRepo.load();
  emit();
  return account;
}

let launched: Promise<Account> | undefined;

/** `loadAccounts`, once per launch: what the door waits on before it reads the vault or the session. */
export function accountsLaunched(): Promise<Account> {
  launched ??= loadAccounts();
  return launched;
}

export function listAccounts(): Promise<Account[]> {
  return accountsRepo.list();
}

/** The active account's id, backend and key row: no await, account 1's until `loadAccounts` has run. */
export function getActiveAccount(): Pick<Account, 'id' | 'backendUrl' | 'keyRef'> {
  return accountsRepo.activeNow();
}

/** Where the active account's backend is: what every call goes to unless it is handed another base. */
export function activeBackendUrl(): string {
  return accountsRepo.activeNow().backendUrl;
}

export async function addAccount(input: { name: string; backendUrl?: string; keyRef?: string }): Promise<Account> {
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return accountsRepo.add({
    id,
    name: input.name,
    backendUrl: (input.backendUrl ?? DEFAULT_BACKEND_URL).replace(/\/+$/, ''),
    keyRef: input.keyRef ?? DEFAULT_KEY_REF,
  });
}

export async function switchAccount(id: string): Promise<void> {
  if (id === accountsRepo.activeNow().id) return;
  await accountsRepo.switchTo(id);
  emit();
}

/** Forgets what is held in memory (a relaunch; tests). `keepStore` leaves the stored accounts as they were. */
export async function resetAccounts(options: { keepStore?: boolean } = {}): Promise<void> {
  launched = undefined;
  await accountsRepo.reset(options.keepStore ?? false);
}
