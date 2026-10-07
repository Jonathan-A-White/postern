// What one Key screen open asks WhatsOnChain (docs/key-screen-reads.md, mw-nlxylg): the balance
// line, the licence check and the Issued licences list all read the key's address history, and
// each transaction's hex is the same bytes whoever asks. Each transaction is read once.
import { PrivateKey, Transaction } from '@bsv/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/data/db';
import { chain } from '../../src/chain';
import { addressForPublicKey } from '../../src/services/licence';
import { setChainReadGapMs, CHAIN_READ_GAP_MS } from '../../src/services/chainPacer';
import { resetSharedChainReads } from '../../src/services/sharedChainReads';
import { signedRecordTxHex } from '../support/nftgate-fixtures';
import { wocStub, type WocStub } from '../support/woc-stub';

const KEY = PrivateKey.fromHex('11'.repeat(32));
const PUBLIC_KEY_HEX = KEY.toPublicKey().toString();
const HOLDER_ADDRESS = addressForPublicKey(PrivateKey.fromHex('22'.repeat(32)).toPublicKey().toString());

/** `count` transactions the key signed, one a mint of `postern` to the holder; their ids, hex and the history pages of `pageSize`. */
async function history(count: number, pageSize = 100) {
  const hexByTxid: Record<string, string> = {};
  const entries: Array<{ tx_hash: string; height: number }> = [];
  for (let i = 0; i < count; i++) {
    const hex = await signedRecordTxHex(KEY, 'M', { collection: i === 0 ? 'postern' : `other-${i}`, holder: HOLDER_ADDRESS }, i);
    const txid = Transaction.fromHex(hex).id('hex');
    hexByTxid[txid] = hex;
    entries.push({ tx_hash: txid, height: 100 + i });
  }
  const pages: Array<typeof entries> = [];
  for (let at = 0; at < entries.length; at += pageSize) pages.unshift(entries.slice(at, at + pageSize));
  return { hexByTxid, pages, txids: entries.map((entry) => entry.tx_hash) };
}

/** The three reads the Key screen makes on opening, as it makes them: all at once. */
async function openKeyScreen(): Promise<void> {
  await Promise.all([
    chain.balance(PUBLIC_KEY_HEX),
    chain.checkLicence(PUBLIC_KEY_HEX),
    chain.issuedLicences({ issuerPublicKeyHex: PUBLIC_KEY_HEX }),
  ]);
}

/** The most requests one open may make: the balance, the pages of confirmed history, the mempool list, each transaction once. */
const budget = (pages: number, transactions: number) => 1 + pages + 1 + transactions;

describe('one Key screen open asks WhatsOnChain for each thing once', () => {
  let stub: WocStub;

  beforeEach(async () => {
    await db.settings.clear();
    resetSharedChainReads();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setChainReadGapMs(0);
  });

  function serve(served: Awaited<ReturnType<typeof history>>) {
    stub = wocStub({ pages: served.pages, hexByTxid: served.hexByTxid, balance: 20_000 });
    vi.stubGlobal('fetch', stub.fetchImpl);
  }

  it('makes 1 + pages + 1 + transactions requests for a key with 5 transactions on one page: 8, not 15', async () => {
    serve(await history(5));
    await openKeyScreen();
    expect(stub.requested).toHaveLength(budget(1, 5));
    expect(stub.requested).toHaveLength(8);
  });

  it('asks for each address list and each transaction only once', async () => {
    const served = await history(5);
    serve(served);
    await openKeyScreen();
    expect(new Set(stub.requested).size).toBe(stub.requested.length);
    for (const txid of served.txids) expect(stub.requested.filter((path) => path.endsWith(`/tx/${txid}/hex`))).toHaveLength(1);
  });

  it('counts three pages of confirmed history: 6 transactions, 2 to a page, make 1 + 3 + 1 + 6 requests', async () => {
    serve(await history(6, 2));
    await openKeyScreen();
    expect(stub.requested).toHaveLength(budget(3, 6));
    expect(stub.requested).toHaveLength(11);
  });

  it('opening the screen again asks for no transaction a second time', async () => {
    serve(await history(5));
    await openKeyScreen();
    stub.requested.length = 0;
    await openKeyScreen();
    expect(stub.requested.filter((path) => path.endsWith('/hex'))).toHaveLength(0);
    expect(stub.requested).toHaveLength(1 + 1 + 1);
  });

  it('a transaction that failed to read is asked for again, the others are not', async () => {
    const served = await history(5);
    serve(served);
    stub.failingHex.add(served.txids[2]);
    await expect(chain.issuedLicences({ issuerPublicKeyHex: PUBLIC_KEY_HEX })).rejects.toThrow();
    stub.requested.length = 0;
    stub.failingHex.clear();
    await chain.issuedLicences({ issuerPublicKeyHex: PUBLIC_KEY_HEX });
    const hexRequests = stub.requested.filter((path) => path.endsWith('/hex'));
    expect(hexRequests.length).toBeGreaterThanOrEqual(1);
    expect(hexRequests.length).toBeLessThan(5);
    expect(hexRequests).toContain(`/v1/bsv/test/tx/${served.txids[2]}/hex`);
  });

  it('spaces every request, history pages included, at least the gap apart', async () => {
    serve(await history(6, 2));
    setChainReadGapMs(25);
    await openKeyScreen();
    const gaps = stub.at.slice(1).map((time, i) => time - stub.at[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(20);
  });

  it('spaces requests 350 ms apart in production', () => {
    expect(CHAIN_READ_GAP_MS).toBe(350);
  });
});
