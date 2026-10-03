// The phone reading the anchor address itself (docs/protocol.md §21): the WhatsOnChain history
// adapter, a record found in a raw transaction, and the txid dedupe.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivateKey } from '@bsv/sdk';
import { chainConfig } from 'spell-forge-bsv';
import { db } from '../../src/data/db';
import { messagesRepo } from '../../src/data/repositories';
import { ANCHOR_ADDRESS } from '../../src/services/messages';
import { encodeCall } from '../../src/services/call';
import {
  CHAIN_MAX_BACKOFF_MS, CHAIN_POLL_MS, HEX_GAP_MS, MAX_TXS_PER_READ, fetchAnchorHistory, fetchRawTransaction, nextChainDelay, readChain, recordsInTransaction,
} from '../../src/services/chainRead';
import { fakeAnchorChain, publicKeyOf, recordTransaction } from '../support/chain-record';

const PHONE = '45'.repeat(32);
const MAYOR = '77'.repeat(32);
const PHONE_PUB = publicKeyOf(PHONE);
const MAYOR_PUB = publicKeyOf(MAYOR);
const phoneKey = new Uint8Array(PrivateKey.fromHex(PHONE).toArray());
const base = `${chainConfig.providerBaseUrl}/address/${ANCHOR_ADDRESS}`;

const ring = (at = 1_790_000_090) =>
  recordTransaction({ senderHex: MAYOR, recipientPublicKeyHex: PHONE_PUB, class: 'call', plaintext: encodeCall({ role: 'ring', text: 'Back now: two landings.', at }), ts: at });

afterEach(async () => {
  await db.messages.clear();
});

function answering(routes: Record<string, { status: number; body: unknown }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const route = routes[String(input)] ?? { status: 404, body: 'not found' };
    const text = typeof route.body === 'string' ? route.body : JSON.stringify(route.body);
    return { ok: route.status < 300, status: route.status, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
  }) as typeof fetch;
}

describe('how long the chain reader waits before its next read', () => {
  it('starts at 5 s, doubles after each read that failed or found nothing up to 60 s, and goes back to 5 s once a clean read finds a record', () => {
    expect(CHAIN_POLL_MS).toBe(5_000);
    expect(CHAIN_MAX_BACKOFF_MS).toBe(60_000);
    for (const [clean, found] of [[false, false], [true, false], [false, true]]) {
      const delays = [CHAIN_POLL_MS];
      for (let i = 0; i < 6; i++) delays.push(nextChainDelay(delays[i], clean, found));
      expect(delays).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000]);
    }
    expect(nextChainDelay(60_000, true, true)).toBe(5_000);
    expect(nextChainDelay(20_000, true, true)).toBe(5_000);
  });
});

describe('the WhatsOnChain history adapter', () => {
  it('lists unconfirmed transactions first, then confirmed ones newest first, each once', async () => {
    const fetchImpl = answering({
      [`${base}/unconfirmed/history`]: { status: 200, body: { result: [{ tx_hash: 'c'.repeat(64), height: 0 }] } },
      [`${base}/confirmed/history`]: {
        status: 200,
        body: { result: [{ tx_hash: 'a'.repeat(64), height: 10 }, { tx_hash: 'b'.repeat(64), height: 12 }, { tx_hash: 'c'.repeat(64), height: 13 }] },
      },
    });
    expect(await fetchAnchorHistory(ANCHOR_ADDRESS, fetchImpl)).toEqual(['c', 'b', 'a'].map((ch) => ch.repeat(64)));
  });

  it('reads an address WhatsOnChain has never seen as no history', async () => {
    const fetchImpl = answering({ [`${base}/unconfirmed/history`]: { status: 200, body: { result: [] } } });
    expect(await fetchAnchorHistory(ANCHOR_ADDRESS, fetchImpl)).toEqual([]);
  });

  it('refuses a list that is not a list, and a failed answer, in plain words', async () => {
    const odd = answering({ [`${base}/unconfirmed/history`]: { status: 200, body: { result: [] } }, [`${base}/confirmed/history`]: { status: 200, body: { oops: 1 } } });
    await expect(fetchAnchorHistory(ANCHOR_ADDRESS, odd)).rejects.toThrow('not a list');
    const failed = answering({ [`${base}/unconfirmed/history`]: { status: 500, body: 'boom' } });
    await expect(fetchAnchorHistory(ANCHOR_ADDRESS, failed)).rejects.toThrow('500');
  });

  it('fetches a raw transaction by id and trims the hex', async () => {
    const txid = 'd'.repeat(64);
    const fetchImpl = answering({ [`${chainConfig.providerBaseUrl}/tx/${txid}/hex`]: { status: 200, body: '0100abcd\n' } });
    expect(await fetchRawTransaction(txid, fetchImpl)).toBe('0100abcd');
    await expect(fetchRawTransaction('e'.repeat(64), fetchImpl)).rejects.toThrow('404');
  });
});

describe('a record in a raw transaction', () => {
  it('is found in its output, and the anchor payment is not one', () => {
    const tx = ring();
    const found = recordsInTransaction(tx.hex);
    expect(found).toHaveLength(1);
    expect(found[0].vout).toBe(0);
    expect(found[0].payload).toMatchObject({ kind: 'msg', class: 'call', to: PHONE_PUB, from: MAYOR_PUB });
  });

  it('finds nothing in a transaction that is not a record, or not a transaction', () => {
    expect(recordsInTransaction('00')).toEqual([]);
    expect(recordsInTransaction('not hex at all')).toEqual([]);
  });
});

describe('reading the chain', () => {
  it('stores and decrypts a record for this phone, and says what was new', async () => {
    const tx = ring();
    const chain = fakeAnchorChain([tx]);
    const { rows } = await readChain({ publicKeyHex: PHONE_PUB, unlockedKey: phoneKey, seen: new Set(), fetchImpl: chain.fetchImpl });
    expect(rows).toHaveLength(1);
    const stored = await messagesRepo.get(`${tx.txid}:0`);
    expect(stored).toMatchObject({ class: 'call', direction: 'received', read: true });
    expect(JSON.parse(stored!.plaintext!)).toMatchObject({ role: 'ring', text: 'Back now: two landings.' });
  });

  it('asks for a transaction once: a second read of the same history fetches no raw transaction', async () => {
    const chain = fakeAnchorChain([ring()]);
    const seen = new Set<string>();
    await readChain({ publicKeyHex: PHONE_PUB, unlockedKey: phoneKey, seen, fetchImpl: chain.fetchImpl });
    const firstCalls = chain.calls.filter((url) => url.endsWith('/hex')).length;
    const again = (await readChain({ publicKeyHex: PHONE_PUB, unlockedKey: phoneKey, seen, fetchImpl: chain.fetchImpl })).rows;
    expect(firstCalls).toBe(1);
    expect(chain.calls.filter((url) => url.endsWith('/hex'))).toHaveLength(1);
    expect(again).toEqual([]);
  });

  it('leaves alone a record the backend already delivered, and reports no new one', async () => {
    const tx = ring();
    await messagesRepo.put({
      id: `${tx.txid}:0`, txid: tx.txid, vout: 0, seq: 7, class: 'call', to: PHONE_PUB, from: MAYOR_PUB, ts: 1, ciphertext: 'x',
      plaintext: 'already here', direction: 'received', read: true, thread: 'call',
    });
    const { rows } = await readChain({ publicKeyHex: PHONE_PUB, unlockedKey: phoneKey, seen: new Set(), fetchImpl: fakeAnchorChain([tx]).fetchImpl });
    expect(rows).toEqual([]);
    expect((await messagesRepo.get(`${tx.txid}:0`))?.seq).toBe(7);
  });

  it('keeps no record that names neither this phone as sender nor as recipient', async () => {
    const stranger = recordTransaction({ senderHex: MAYOR, recipientPublicKeyHex: publicKeyOf('99'.repeat(32)), class: 'message', plaintext: 'hi', ts: 5 });
    const { rows } = await readChain({ publicKeyHex: PHONE_PUB, unlockedKey: phoneKey, seen: new Set(), fetchImpl: fakeAnchorChain([stranger]).fetchImpl });
    expect(rows).toEqual([]);
    expect(await messagesRepo.getAll()).toEqual([]);
  });

  it('reads only the throttle\'s share of a long history in one pass, the rest on the next', async () => {
    const txs = Array.from({ length: 22 }, (_, i) => recordTransaction({ senderHex: MAYOR, recipientPublicKeyHex: PHONE_PUB, class: 'message', plaintext: `m${i}`, ts: 100 + i }));
    const chain = fakeAnchorChain(txs);
    const seen = new Set<string>();
    const read = () => readChain({ publicKeyHex: PHONE_PUB, unlockedKey: phoneKey, seen, fetchImpl: chain.fetchImpl, hexGapMs: 0 });
    const first = (await read()).rows;
    expect(first).toHaveLength(MAX_TXS_PER_READ);
    expect(chain.calls.filter((url) => url.endsWith('/hex'))).toHaveLength(MAX_TXS_PER_READ);
    const second = (await read()).rows;
    expect(second).toHaveLength(MAX_TXS_PER_READ);
    const third = (await read()).rows;
    expect(third).toHaveLength(22 - 2 * MAX_TXS_PER_READ);
    expect(seen.size).toBe(22);
  });

  it('spaces its hex fetches by the gap: at most about two a second', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const txs = Array.from({ length: 3 }, (_, i) => recordTransaction({ senderHex: MAYOR, recipientPublicKeyHex: PHONE_PUB, class: 'message', plaintext: `g${i}`, ts: 100 + i }));
      const chain = fakeAnchorChain(txs);
      const hexCalls = () => chain.calls.filter((url) => url.endsWith('/hex')).length;
      const settle = async () => {
        for (let i = 0; i < 8; i++) {
          await vi.advanceTimersByTimeAsync(0);
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      };
      const done = readChain({ publicKeyHex: PHONE_PUB, unlockedKey: phoneKey, seen: new Set(), fetchImpl: chain.fetchImpl });
      await settle();
      expect(hexCalls()).toBe(1);
      await vi.advanceTimersByTimeAsync(HEX_GAP_MS - 1);
      await settle();
      expect(hexCalls()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await settle();
      expect(hexCalls()).toBe(2);
      await vi.advanceTimersByTimeAsync(HEX_GAP_MS);
      await settle();
      expect((await done).rows).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the records it read when one hex fetch fails, and asks for the failed transaction again next time', async () => {
    const txs = [0, 1, 2].map((i) => recordTransaction({ senderHex: MAYOR, recipientPublicKeyHex: PHONE_PUB, class: 'message', plaintext: `f${i}`, ts: 100 + i }));
    const chain = fakeAnchorChain(txs);
    const seen = new Set<string>();
    chain.failHex.add(txs[1].txid); // the middle of the history (read second, newest first)
    const read = () => readChain({ publicKeyHex: PHONE_PUB, unlockedKey: phoneKey, seen, fetchImpl: chain.fetchImpl, hexGapMs: 0 });
    const first = await read();
    expect(first.rows).toHaveLength(2);
    expect(first.failed).toBe(1);
    expect(seen.has(txs[1].txid)).toBe(false);
    expect(seen.has(txs[0].txid) && seen.has(txs[2].txid)).toBe(true);
    chain.calls.length = 0;
    chain.failHex.clear();
    const second = await read();
    expect(second.rows).toHaveLength(1);
    expect(second.failed).toBe(0);
    expect(chain.calls.filter((url) => url.endsWith('/hex'))).toEqual([`${chainConfig.providerBaseUrl}/tx/${txs[1].txid}/hex`]);
  });

  it('keeps the events batches it read when a later hex fetch fails', async () => {
    const batch = { from: 4, to: 4, lane: 'normal', events: [{ seq: 4, ts: 1_790_000_000, kind: 'bead_changed', bead: 'mw-x.1', actor: 'mw', from: 'open', to: 'claimed', detail: 'status' }] };
    const events = recordTransaction({ senderHex: MAYOR, recipientPublicKeyHex: PHONE_PUB, class: 'events', plaintext: JSON.stringify(batch), ts: 1_790_000_000 });
    const later = ring();
    const chain = fakeAnchorChain([events, later]); // `later` is newest, read first
    chain.failHex.add(events.txid);
    const first = await readChain({ publicKeyHex: PHONE_PUB, unlockedKey: phoneKey, mayorKey: MAYOR_PUB, seen: new Set(), fetchImpl: chain.fetchImpl, hexGapMs: 0 });
    expect(first.rows).toHaveLength(1);
    expect(first.failed).toBe(1);
    const chain2 = fakeAnchorChain([later, events]); // events newest, read first, then a failure after it
    chain2.failHex.add(later.txid);
    const second = await readChain({ publicKeyHex: PHONE_PUB, unlockedKey: phoneKey, mayorKey: MAYOR_PUB, seen: new Set(), fetchImpl: chain2.fetchImpl, hexGapMs: 0 });
    expect(second.events).toHaveLength(1);
    expect(second.failed).toBe(1);
  });

  it('stops the read at a 429 rather than asking for more, and counts it failed', async () => {
    const txs = [0, 1, 2].map((i) => recordTransaction({ senderHex: MAYOR, recipientPublicKeyHex: PHONE_PUB, class: 'message', plaintext: `t${i}`, ts: 100 + i }));
    const chain = fakeAnchorChain(txs);
    chain.hexStatus = 429;
    const seen = new Set<string>();
    const read = await readChain({ publicKeyHex: PHONE_PUB, unlockedKey: phoneKey, seen, fetchImpl: chain.fetchImpl, hexGapMs: 0 });
    expect(chain.calls.filter((url) => url.endsWith('/hex'))).toHaveLength(1);
    expect(read.failed).toBe(1);
    expect(read.rows).toEqual([]);
    expect(seen.size).toBe(0);
  });

  it('forgets nothing it failed to read: a transaction WhatsOnChain would not give is asked for again', async () => {
    const tx = ring();
    const chain = fakeAnchorChain([tx]);
    const seen = new Set<string>();
    chain.down = true;
    await expect(readChain({ publicKeyHex: PHONE_PUB, unlockedKey: phoneKey, seen, fetchImpl: chain.fetchImpl })).rejects.toThrow();
    chain.down = false;
    expect((await readChain({ publicKeyHex: PHONE_PUB, unlockedKey: phoneKey, seen, fetchImpl: chain.fetchImpl })).rows).toHaveLength(1);
  });

  describe('events records (§22)', () => {
    const batch = { from: 4, to: 4, lane: 'normal', events: [{ seq: 4, ts: 1_790_000_000, kind: 'bead_changed', bead: 'mw-x.1', actor: 'mw', from: 'open', to: 'claimed', detail: 'status' }] };
    const events = (senderHex: string) =>
      recordTransaction({ senderHex, recipientPublicKeyHex: PHONE_PUB, class: 'events', plaintext: JSON.stringify(batch), ts: 1_790_000_000 });

    it("hands back the pinned Mayor's batch, decrypted, and keeps no message for it", async () => {
      const read = await readChain({ publicKeyHex: PHONE_PUB, unlockedKey: phoneKey, mayorKey: MAYOR_PUB, seen: new Set(), fetchImpl: fakeAnchorChain([events(MAYOR)]).fetchImpl });
      expect(read.rows).toEqual([]);
      expect(read.events).toHaveLength(1);
      expect(read.events[0]).toMatchObject({ from: 4, to: 4, lane: 'normal' });
      expect(read.events[0].events[0]).toMatchObject({ seq: 4, kind: 'bead_changed', bead: 'mw-x.1' });
      expect(await messagesRepo.getAll()).toEqual([]);
    });

    it('reads a batch from any other key as nothing, and so with no Mayor pinned', async () => {
      const stranger = events('99'.repeat(32));
      const strangerRead = await readChain({ publicKeyHex: PHONE_PUB, unlockedKey: phoneKey, mayorKey: MAYOR_PUB, seen: new Set(), fetchImpl: fakeAnchorChain([stranger]).fetchImpl });
      expect(strangerRead.events).toEqual([]);
      const unpinned = await readChain({ publicKeyHex: PHONE_PUB, unlockedKey: phoneKey, seen: new Set(), fetchImpl: fakeAnchorChain([events(MAYOR)]).fetchImpl });
      expect(unpinned.events).toEqual([]);
    });
  });
});
