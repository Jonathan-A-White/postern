// src/services/accounts.ts — the accounts this app keeps and which one is active (mw-9rp4hu.4). The client
// (apiAuth.ts), the unlocked key (keySession.ts), the licence (licence.ts), Ideas only and every store (db.ts)
// are the active account's, so a screen asks for none of them by account. Settings > Accounts adds, switches, renames and
// removes them (mw-9rp4hu.5); a switch first lets the old account's work finish into its own store (onAccountLeaving).
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

let version = 0;

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** Changes whenever the accounts, or which one is active, may have changed: what a screen or effect that must start again reads. */
export function accountsVersion(): number {
  return version;
}

const leavers = new Set<() => void | Promise<void>>();

/** Called when the active account is about to change, before it does: stop what the old account runs and let what it has begun to
 * write finish into its own store (src/services/live.ts, outbox.ts), so nothing of it lands in the next account's. The switch
 * waits for each; one that throws does not hold it. */
export function onAccountLeaving(listener: () => void | Promise<void>): () => void {
  leavers.add(listener);
  return () => leavers.delete(listener);
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

/** A backend's address as the account keeps it: a full address (https://host/api) or this site's own path (/api), no trailing slash. */
export function normalizeBackendUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, '');
  if (!/^(https?:\/\/[^\s/?#]+(\/[^\s?#]*)?|\/[^\s/?#][^\s?#]*)$/i.test(url)) {
    throw new Error("That is not a backend address. Type it as it is given to you, like https://example.org/api.");
  }
  return url;
}

export function newAccountId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

export async function addAccount(input: { name: string; backendUrl?: string; keyRef?: string; id?: string }): Promise<Account> {
  return accountsRepo.add({
    id: input.id ?? newAccountId(),
    name: input.name,
    backendUrl: (input.backendUrl ?? DEFAULT_BACKEND_URL).replace(/\/+$/, ''),
    keyRef: input.keyRef ?? DEFAULT_KEY_REF,
  });
}

/** A name for the account: the one typed, else the backend's host. */
export function accountNameFor(typed: string, backendUrl: string): string {
  const name = typed.trim();
  if (name) return name;
  return /^https?:\/\//i.test(backendUrl) ? new URL(backendUrl).host : 'Postern';
}

export async function renameAccount(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('An account needs a name.');
  await accountsRepo.update(id, { name: trimmed });
  emit();
}

const removed = new Set<(id: string) => void>();

/** Called with the id of an account that was removed, for whatever holds something of it in memory. */
export function onAccountRemoved(listener: (id: string) => void): () => void {
  removed.add(listener);
  return () => removed.delete(listener);
}

/** Takes an account off the list. Its key is not deleted: its store stays on the phone. The active account is left first (account 1, or the first other). */
export async function removeAccount(id: string): Promise<void> {
  const accounts = await accountsRepo.list();
  if (accounts.length <= 1) throw new Error('The last account cannot be removed.');
  if (id === accountsRepo.activeNow().id) await switchAccount((accounts.find((account) => account.id !== id) as Account).id);
  await accountsRepo.remove(id);
  for (const listener of removed) listener(id);
  emit();
}

let switching: Promise<unknown> = Promise.resolve();

/** Makes `id` the active account: the old one's work is stopped and let finish into its own store first, then the client, key, licence,
 * Ideas only and stores are the new one's, and the app is told. Switches run one at a time, in the order asked. */
export function switchAccount(id: string): Promise<void> {
  const turn = async (): Promise<void> => {
    if (id === accountsRepo.activeNow().id) return;
    if (!(await accountsRepo.list()).some((account) => account.id === id)) throw new Error(`There is no account ${id}.`);
    await Promise.all(
      [...leavers].map(async (leaving) => {
        try {
          await leaving();
        } catch {
          // an account's stopping does not hold the switch
        }
      }),
    );
    try {
      await accountsRepo.switchTo(id);
    } catch (err) {
      emit(); // what stopped on leaving starts again for the account the app is still on
      throw err;
    }
    emit();
  };
  const run = switching.then(turn, turn);
  switching = run;
  return run;
}

/** Whether `id` names an account other than the one on screen: what a message from a push registration's worker (src/sw.ts) says it is about. */
export function isOtherAccount(id: string | undefined): id is string {
  return id !== undefined && id !== '' && id !== accountsRepo.activeNow().id;
}

/** A tap on a notification of another account lands in that account: the app switches to it first. An account that is gone leaves the app where it is. */
export async function landOnAccount(id: string | undefined): Promise<void> {
  if (!isOtherAccount(id)) return;
  try {
    await switchAccount(id);
  } catch {
    // the account was removed since the notification was shown
  }
}

/** Forgets what is held in memory (a relaunch; tests). `keepStore` leaves the stored accounts as they were. */
export async function resetAccounts(options: { keepStore?: boolean } = {}): Promise<void> {
  launched = undefined;
  await accountsRepo.reset(options.keepStore ?? false);
}
