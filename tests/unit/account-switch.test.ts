// mw-9rp4hu.5 AC4: a switch of the active account leaves nothing of the old account running or writing. Each test
// switches while something of the old account is in flight and fails without the fix: the live stream and poll stop
// and start again on the new account, a sync under way finishes into its own account's store, the outbox row being
// sent is kept in its own account's outbox and the new account's rows go with the new account's key and backend,
// per-account memory is flushed, and an Ideas only answer is kept on the account that asked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivateKey } from '@bsv/sdk';
import { accountDb, db } from '../../src/data/db';
import { accountsRepo, outboxRepo, settingsRepo } from '../../src/data/repositories';
import { addAccount, loadAccounts, resetAccounts, switchAccount, getActiveAccount } from '../../src/services/accounts';
import { lock, setKey } from '../../src/services/keySession';
import { QUIET_LIMIT_MS, getLiveState, startLive, stopLive } from '../../src/services/live';
import { viewThrottle } from '../../src/services/viewThrottle';
import { kickOutbox, forgetOutboxState, settledOutbox, startOutbox } from '../../src/services/outbox';
import { recallRead, rememberRead } from '../../src/cockpit/lastKnown';
import { getIdeasOnly } from '../../src/services/ideasOnly';
import { publicKeyHexFromMasterKey } from '../../src/services/vault';
import type { DeliverOptions } from '../../src/services/deliver';

vi.mock('../../src/services/session', () => ({
  persistSession: vi.fn(async () => true),
  restoreSession: vi.fn(async () => null),
  clearSession: vi.fn(async () => undefined),
}));

const control = vi.hoisted(() => ({
  fetchMe: undefined as unknown as ReturnType<typeof vi.fn>,
  sync: undefined as undefined | (() => Promise<{ applied: number; refetched: boolean }>),
  deliver: undefined as undefined | ((options: DeliverOptions) => Promise<{ txid: string; channel: 'direct' }>),
  delivered: [] as DeliverOptions[],
}));

vi.mock('../../src/services/me', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/services/me')>();
  control.fetchMe = vi.fn(async () => ({ pubkey: '', mayor: 'aa'.repeat(33), network: 'testnet', features: [] }));
  return { ...real, fetchMe: control.fetchMe, reconcileMayorKey: vi.fn(async () => ({ pinned: 'aa'.repeat(33), offered: undefined })) };
});
vi.mock('../../src/services/events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/events')>()),
  syncMessagesAndEvents: vi.fn(async () => (control.sync ? control.sync() : { applied: 0, refetched: false })),
}));
vi.mock('../../src/services/view', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/view')>()),
  refreshView: vi.fn(async () => 'unchanged' as const),
}));
vi.mock('../../src/services/presence', () => ({ fetchMayorHere: () => Promise.resolve(undefined) }));
vi.mock('../../src/services/deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/deliver')>()),
  deliverAction: vi.fn(async (_action: unknown, options: DeliverOptions) => {
    control.delivered.push(options);
    return control.deliver ? control.deliver(options) : { txid: 'direct:' + 'ab'.repeat(32), channel: 'direct' as const };
  }),
}));

const KEY_A = new Uint8Array(PrivateKey.fromHex('0a'.repeat(32)).toArray());
const KEY_B = new Uint8Array(PrivateKey.fromHex('0b'.repeat(32)).toArray());
const B_URL = 'https://b.example/api';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function letStorageRun(): Promise<void> {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve));
}

const MESSAGE = {
  id: 'a'.repeat(64) + ':0',
  txid: 'a'.repeat(64),
  vout: 0,
  seq: 1,
  class: 'message' as const,
  to: 'x',
  from: 'y',
  ts: 1,
  ciphertext: 'ab',
  direction: 'received' as const,
  read: false,
};

let b: Awaited<ReturnType<typeof addAccount>>;

beforeEach(async () => {
  vi.useRealTimers();
  stopLive();
  forgetOutboxState();
  lock();
  await resetAccounts();
  await Promise.all([db.settings.clear(), db.vault.clear(), db.messages.clear(), db.outbox.clear()]);
  control.sync = undefined;
  control.deliver = undefined;
  control.delivered = [];
  control.fetchMe.mockClear();
  await loadAccounts();
  b = await addAccount({ name: 'Luke', backendUrl: B_URL });
  await accountDb(b.id).messages.clear();
  await accountDb(b.id).outbox.clear();
  await accountDb(b.id).settings.clear();
  setKey(KEY_A);
});

afterEach(async () => {
  stopLive();
  forgetOutboxState();
  await settledOutbox();
  vi.useRealTimers();
});

describe('the live connection follows the active account', () => {
  it('stops with the old account, says nothing of it, and starts again for the new one', async () => {
    startLive(KEY_A);
    await letStorageRun();
    expect(control.fetchMe).toHaveBeenCalledTimes(1);
    expect(getLiveState().mayorKey).toBe('aa'.repeat(33));
    viewThrottle.lastFetchAt = 123;

    await switchAccount(b.id);

    expect(getLiveState().status).toBe('idle');
    expect(getLiveState().me).toBeNull();
    expect(getLiveState().mayorKey).toBeUndefined();
    expect(viewThrottle.lastFetchAt).toBe(-Infinity);

    // The same key object under the new account (the same key on two backends) is still a new connection.
    startLive(KEY_A);
    await letStorageRun();
    expect(control.fetchMe).toHaveBeenCalledTimes(2);
  });

  it('lets a sync under way finish into the account that began it, not the one switched to', async () => {
    const release = deferred<void>();
    control.sync = async () => {
      await release.promise;
      await db.messages.put(MESSAGE); // as storeRecord does: through `db`, at the time of the write
      return { applied: 0, refetched: false };
    };
    startLive(KEY_A);
    await letStorageRun();

    const switching = switchAccount(b.id);
    await letStorageRun();
    release.resolve();
    await switching;

    expect(await accountDb('1').messages.count()).toBe(1);
    expect(await accountDb(b.id).messages.count()).toBe(0);
  });

  it('does not wait for ever on a sync that never ends', async () => {
    const never = deferred<void>();
    control.sync = async () => {
      await never.promise;
      return { applied: 0, refetched: false };
    };
    startLive(KEY_A);
    await letStorageRun();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    try {
      let switched = false;
      const switching = switchAccount(b.id).then(() => (switched = true));
      await letStorageRun(); // the stopping has begun and its wait is set
      await vi.advanceTimersByTimeAsync(QUIET_LIMIT_MS - 100);
      expect(switched).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      await letStorageRun();
      await switching;
      expect(switched).toBe(true);
      expect(getActiveAccount().id).toBe(b.id);
    } finally {
      vi.useRealTimers();
      never.resolve();
      await letStorageRun();
    }
  });
});

describe('the outbox follows the active account', () => {
  const action = { action: 'noop', bead: 'mw-1' };
  const addRow = (store: typeof db) => store.outbox.add({ kind: 'action', bead: 'mw-1', payload: { action }, created: Date.now(), attempts: 0, state: 'pending' });

  it('keeps the row it was sending in its own outbox, and sends the new account\'s rows with the new account\'s key and backend', async () => {
    const stop = startOutbox();
    try {
      startLive(KEY_A);
      await letStorageRun();
      const release = deferred<void>();
      control.deliver = async () => {
        await release.promise;
        return { txid: 'direct:' + 'cd'.repeat(32), channel: 'direct' };
      };
      const idA = await addRow(accountDb('1'));
      const idB = await addRow(accountDb(b.id)); // the same row id in the other store: a late write by id would land on this one
      expect(idB).toBe(idA);
      kickOutbox();
      await letStorageRun();
      expect(control.delivered).toHaveLength(1);

      const switching = switchAccount(b.id);
      await letStorageRun();
      release.resolve();
      await switching;
      control.deliver = undefined;
      setKey(KEY_B);
      startLive(KEY_B);
      await letStorageRun();
      await settledOutbox();
      await letStorageRun();
      await settledOutbox();

      expect((await accountDb('1').outbox.get(idA))?.state).toBe('sent');
      expect((await accountDb(b.id).outbox.get(idB))?.txid).not.toBe('direct:' + 'cd'.repeat(32));
      // The second delivery is the new account's own row.
      expect(control.delivered).toHaveLength(2);
      expect(control.delivered[1].apiBase).toBe(B_URL);
      expect(control.delivered[1].key).toBe(KEY_B);
      expect(control.delivered[0].apiBase).toBe('/api');
      expect(await outboxRepo.all()).toHaveLength(1); // the active account's (the new one's) own row
    } finally {
      stop();
    }
  });
});

describe('what the app remembers is the active account\'s', () => {
  it('forgets what the screens last read', async () => {
    rememberRead('needs', ['from account 1']);
    expect(recallRead('needs').known).toBe(true);
    await switchAccount(b.id);
    expect(recallRead('needs').known).toBe(false);
  });
});

describe('an Ideas only answer is kept on the account that asked', () => {
  it('lands on the account that was active when it asked, whichever is active when the answer comes', async () => {
    const answer = deferred<Response>();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => (String(input).endsWith('/challenge') ? new Response(JSON.stringify({ nonce: 'c'.repeat(64) })) : answer.promise)) as unknown as typeof fetch;
    const asking = getIdeasOnly(KEY_A, { fetchImpl });
    await letStorageRun();

    await switchAccount(b.id);
    answer.resolve(new Response(JSON.stringify({ setting: { until: 0, reaches: {} }, state: { on: false, until: 0, by: '' } })));
    const result = await asking;

    expect(result.ok).toBe(true);
    expect((await accountsRepo.list()).find((account) => account.id === '1')?.ideasOnly?.key).toBe(publicKeyHexFromMasterKey(KEY_A));
    expect((await accountsRepo.list()).find((account) => account.id === b.id)?.ideasOnly).toBeUndefined();
    expect(await settingsRepo.getIdeasOnly()).toBeUndefined();
  });
});
