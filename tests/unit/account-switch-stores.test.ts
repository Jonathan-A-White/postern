// mw-9rp4hu.5 AC4: the daily-unlock session is written to the store pinned when the key was set, and the database
// trouble handlers (a blocked open, a copy upgraded by another window) are on every account's database.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accountDb, db } from '../../src/data/db';
import { addAccount, loadAccounts, resetAccounts, switchAccount } from '../../src/services/accounts';
import { lock, setKey } from '../../src/services/keySession';
import { clearDbTrouble, getDbTrouble, resetDbTrouble } from '../../src/data/dbTrouble';

const KEY = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1));

async function letStorageRun(): Promise<void> {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve));
}

/** Waits for a count that real crypto (off the event loop's thread) and storage bring about. */
async function settles(count: () => Promise<number>, wanted: number): Promise<void> {
  const until = Date.now() + 3000;
  while (Date.now() < until && (await count()) !== wanted) await new Promise((resolve) => setTimeout(resolve, 10));
}

let b: Awaited<ReturnType<typeof addAccount>>;

beforeEach(async () => {
  lock();
  await resetAccounts();
  await Promise.all([db.settings.clear(), db.session.clear()]);
  await loadAccounts();
  b = await addAccount({ name: 'Luke', backendUrl: 'https://b.example/api' });
  await accountDb(b.id).session.clear();
  resetDbTrouble();
});

describe('the daily unlock is kept on the account that unlocked', () => {
  it('writes the wrapped key to the store pinned at setKey, though the app has switched before it finishes', async () => {
    const real = crypto.subtle.encrypt.bind(crypto.subtle);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const spy = vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args: Parameters<typeof real>) => {
      await gate;
      return real(...args);
    });
    try {
      setKey(KEY, Date.now() + 60_000); // account 1 unlocks; the wrapping is under way
      await letStorageRun();
      await switchAccount(b.id);
      release();
      await settles(() => accountDb('1').session.count(), 1);
      await letStorageRun();

      expect(await accountDb('1').session.count()).toBe(1);
      expect(await accountDb(b.id).session.count()).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('clears the pinned account\'s session on lock, not the active one\'s', async () => {
    setKey(KEY, Date.now() + 60_000);
    await settles(() => accountDb('1').session.count(), 1);
    expect(await accountDb('1').session.count()).toBe(1);
    await switchAccount(b.id);
    setKey(KEY, Date.now() + 60_000);
    await settles(() => accountDb(b.id).session.count(), 1);
    expect(await accountDb(b.id).session.count()).toBe(1);
    lock(); // locks account b
    await settles(() => accountDb(b.id).session.count(), 0);
    expect(await accountDb(b.id).session.count()).toBe(0);
    expect(await accountDb('1').session.count()).toBe(1);
  });
});

describe('a database trouble on any account\'s store is told', () => {
  it('hears a blocked open on a second account\'s database', async () => {
    await switchAccount(b.id);
    clearDbTrouble();
    (accountDb(b.id).on as unknown as { blocked: { fire(event: unknown): void } }).blocked.fire({ oldVersion: 1, newVersion: 2 });
    expect(getDbTrouble()).toBe('blocked');
  });
});
