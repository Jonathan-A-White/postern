// src/data/repositories/accounts-repo.ts — the accounts this app keeps (mw-9rp4hu.4). An Account is
// {id, name, backendUrl, keyRef, licence, ideasOnly}: which backend, which vault row holds its key, what the
// licence check last said and what Ideas only last said for its key. The list and the active id are rows of the
// first account's settings table (the store every phone has always had), so they are found before any account's
// own store is chosen; each account's cache (messages, view, cards, outbox…) is its own store (db.ts).
//
// Yesterday's phone has one backend, one key, one licence and no accounts: it is read as account 1 at once and stored
// as that on the first launch or write, folding in the 'licence-status' and 'ideasOnly' rows an older build kept (a row an older build writes
// later is folded in the same way, then removed, so going back and forth loses nothing).
import { activateAccountDb, activeAccountDbId, closeOtherAccountDbs, defaultDb, FIRST_ACCOUNT_ID } from '../db';
import type { IdeasOnlyKept } from '../../model/ideasOnly';

/** The backend an account has when it names none: the app's own origin (resolved at runtime). */
export const DEFAULT_BACKEND_URL = '/api';
/** The vault row an account's key lives in, in its own store. */
export const DEFAULT_KEY_REF = 'default';

export interface LicenceOutpoint {
  txid: string;
  vout: number;
}

/** `collection` is absent on a row cached before it was recorded (mw-kiubh7.1): read such a row as unknown and check afresh.
 * Defined here, where the account keeps it, and re-exported by src/services/licence.ts. */
export type LicenceStatus =
  | { held: true; outpoint: LicenceOutpoint; collection?: string; checkedAt: string }
  | { held: false; checkedAt: string };

export interface Account {
  id: string;
  name: string;
  /** Where this account's `/challenge`, `/messages`, `/view`… are: no trailing slash. */
  backendUrl: string;
  /** The vault row (in this account's store) holding the key it signs with. */
  keyRef: string;
  /** What the licence check last said for this account's key, with the time. */
  licence?: LicenceStatus;
  /** Ideas only as the backend last answered for this account's key. */
  ideasOnly?: IdeasOnlyKept;
}

const ACCOUNTS_KEY = 'accounts';
const ACTIVE_KEY = 'activeAccountId';
const LEGACY_LICENCE_KEY = 'licence-status';
const LEGACY_IDEAS_ONLY_KEY = 'ideasOnly';

const FIRST_ACCOUNT: Account = { id: FIRST_ACCOUNT_ID, name: 'Postern', backendUrl: DEFAULT_BACKEND_URL, keyRef: DEFAULT_KEY_REF };

/** What the app needs at once, with no await: the active account's id, backend and key row. */
let current: Pick<Account, 'id' | 'backendUrl' | 'keyRef'> = FIRST_ACCOUNT;

const settings = () => defaultDb.settings;

/** The stored accounts, or none; and whether an older build left a row to fold in. */
async function readRows() {
  const [stored, legacyLicence, legacyIdeas] = await Promise.all([
    settings().get(ACCOUNTS_KEY),
    settings().get(LEGACY_LICENCE_KEY),
    settings().get(LEGACY_IDEAS_ONLY_KEY),
  ]);
  const accounts = Array.isArray(stored?.value) && stored.value.length > 0 ? (stored.value as Account[]) : undefined;
  const legacy = legacyLicence?.value !== undefined || legacyIdeas?.value !== undefined;
  return { accounts, legacyLicence: legacyLicence?.value as LicenceStatus | undefined, legacyIdeas: legacyIdeas?.value as IdeasOnlyKept | undefined, legacy };
}

/** The accounts as they stand: the stored ones, or the one an older phone has made account 1, with any legacy row folded in.
 * A read only reads (it may run inside a live query, where a write would end the subscription); `settle` stores the result. */
function foldRows(rows: Awaited<ReturnType<typeof readRows>>): Account[] {
  const accounts: Account[] = rows.accounts ? [...rows.accounts] : [{ ...FIRST_ACCOUNT }];
  if (!rows.legacy) return accounts;
  const at = Math.max(0, accounts.findIndex((account) => account.id === FIRST_ACCOUNT_ID));
  const folded: Account = { ...accounts[at] };
  if (rows.legacyLicence !== undefined) folded.licence = rows.legacyLicence;
  if (rows.legacyIdeas !== undefined) folded.ideasOnly = rows.legacyIdeas;
  accounts[at] = folded;
  return accounts;
}

async function readAccounts(): Promise<Account[]> {
  return foldRows(await readRows());
}

/** Stores the accounts as `change` leaves them (the migration, when nothing was stored), and removes the legacy rows, in one transaction. */
async function settle(change: (accounts: Account[]) => Account[] = (accounts) => accounts): Promise<Account[]> {
  return defaultDb.transaction('rw', defaultDb.settings, async () => {
    const accounts = change(foldRows(await readRows()));
    await write(accounts);
    await settings().bulkDelete([LEGACY_LICENCE_KEY, LEGACY_IDEAS_ONLY_KEY]);
    return accounts;
  });
}

async function write(accounts: Account[]): Promise<void> {
  await settings().put({ key: ACCOUNTS_KEY, value: accounts });
}

function adopt(account: Account): void {
  current = { id: account.id, backendUrl: account.backendUrl, keyRef: account.keyRef };
  activateAccountDb(account.id);
}

export const accountsRepo = {
  /** Every account, the first one made from an older phone's single account if need be. */
  async list(): Promise<Account[]> {
    return readAccounts();
  },

  /** The id the app was last left on (account 1 when none is stored, or the stored one is gone). */
  async storedActiveId(): Promise<string> {
    const accounts = await readAccounts();
    const row = await settings().get(ACTIVE_KEY);
    return accounts.some((account) => account.id === row?.value) ? (row?.value as string) : accounts[0].id;
  },

  /** On launch: reads the accounts and makes the stored active one the one `db` and the client use. */
  async load(): Promise<Account> {
    const accounts = await settle();
    const id = await this.storedActiveId();
    const account = accounts.find((candidate) => candidate.id === id) ?? accounts[0];
    adopt(account);
    return account;
  },

  /** The active account as stored. */
  async active(): Promise<Account> {
    const accounts = await readAccounts();
    return accounts.find((account) => account.id === activeAccountDbId()) ?? accounts[0];
  },

  /** The active account's id, backend and key row, with no await (account 1's until `load` has run). */
  activeNow(): Pick<Account, 'id' | 'backendUrl' | 'keyRef'> {
    return current;
  },

  /** Makes this account the active one, and remembers it. */
  async switchTo(id: string): Promise<Account> {
    const accounts = await readAccounts();
    const account = accounts.find((candidate) => candidate.id === id);
    if (!account) throw new Error(`There is no account ${id}.`);
    await settle();
    await settings().put({ key: ACTIVE_KEY, value: id });
    adopt(account);
    return account;
  },

  async add(account: Account): Promise<Account> {
    await settle((accounts) => {
      if (accounts.some((candidate) => candidate.id === account.id)) throw new Error(`There is already an account ${account.id}.`);
      return [...accounts, account];
    });
    return account;
  },

  /** Changes fields of one account, whole in one transaction (a licence check and an Ideas only answer may land together). */
  async update(id: string, patch: Partial<Omit<Account, 'id'>>): Promise<void> {
    const next = await settle((accounts) => accounts.map((account) => (account.id === id ? { ...account, ...patch } : account)));
    const changed = next.find((account) => account.id === id);
    if (changed && id === current.id) current = { id, backendUrl: changed.backendUrl, keyRef: changed.keyRef };
  },

  async updateActive(patch: Partial<Omit<Account, 'id'>>): Promise<void> {
    await this.update(activeAccountDbId(), patch);
  },

  /** Forgets what is held in memory: the next launch's state. With `keepStore` false (tests) the stored accounts go too. */
  async reset(keepStore = false): Promise<void> {
    current = FIRST_ACCOUNT;
    activateAccountDb(FIRST_ACCOUNT_ID);
    closeOtherAccountDbs();
    if (!keepStore) await settings().bulkDelete([ACCOUNTS_KEY, ACTIVE_KEY]);
  },
};
