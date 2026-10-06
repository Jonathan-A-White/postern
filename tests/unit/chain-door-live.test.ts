// live's chain poll reads through src/chain.ts (mw-e6e8f2.2): a fake plugged in with setChain is read.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivateKey } from '@bsv/sdk';
import { act } from '@testing-library/react';
import { chain, setChain, type Chain, type ChainRead, type ReadChainParams } from '../../src/chain';
import { startLive, stopLive } from '../../src/services/live';
import { db } from '../../src/data/db';

vi.mock('../../src/services/apiAuth', () => ({
  apiFetch: vi.fn(async () => {
    throw new Error('The network dropped.');
  }),
}));
vi.mock('../../src/services/inbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/inbox')>()),
  syncMessages: vi.fn(async () => {
    throw new Error('The backend did not answer.');
  }),
}));
vi.mock('../../src/services/view', () => ({
  refreshView: vi.fn(async () => {
    throw new Error('The backend did not answer.');
  }),
}));
vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: vi.fn(async () => ({ pubkey: '', mayor: '', network: 'testnet', features: ['events'] })),
  reconcileMayorKey: vi.fn(async () => ({ pinned: undefined, offered: undefined })),
}));
vi.mock('../../src/services/presence', () => ({ fetchMayorHere: () => Promise.resolve(undefined) }));

const phoneKey = new Uint8Array(PrivateKey.fromHex('07'.repeat(32)).toArray());
let previous: Chain | undefined;

beforeEach(async () => {
  await db.messages.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  stopLive();
  if (previous) setChain(previous);
  previous = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('live with a second chain plugged in', () => {
  it('reads new records from the fake, on the fake\'s own poll interval, and asks no WhatsOnChain', async () => {
    const fetchSpy = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchSpy);
    const read = vi.fn<(params: ReadChainParams) => Promise<ChainRead>>(async () => ({ rows: [], events: [], failed: 0 }));
    previous = setChain({ ...chain, pollMs: 1_000, read });

    await act(async () => {
      startLive(phoneKey);
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });

    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[0]).toMatchObject({ unlockedKey: phoneKey });
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('whatsonchain'))).toBe(false);
  });
});
