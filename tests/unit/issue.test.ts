import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrivateKey, Transaction, Utils } from '@bsv/sdk';
import { chainConfig, decodeTypedRecordScript, type ChainProvider } from 'spell-forge-bsv';
import { db } from '../../src/data/db';
import { addressForPublicKey } from '../../src/services/licence';
import { setBusyRetryDelaysMs } from '../../src/services/chainBusy';
import {
  IssueError,
  fetchIssuerBalance,
  issueCost,
  issueLicence,
  issuedLicences,
  revokeLicence,
} from '../../src/services/issue';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';
import { FakeChainProvider } from '../support/fake-chain-provider';
import { signedRecordTxHex } from '../support/nftgate-fixtures';

vi.mock('spell-forge-bsv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('spell-forge-bsv')>();
  const { createFakeMintBuilder } = await import('../support/fake-mint-builder');
  return { ...actual, buildContractMintTransaction: createFakeMintBuilder(actual.encodeTypedRecordScript) };
});

const ISSUER = PrivateKey.fromHex('11'.repeat(32));
const ISSUER_MASTER = new Uint8Array(ISSUER.toArray('be', 32));
const ISSUER_PUBLIC_KEY = ISSUER.toPublicKey().toString();
const ISSUER_ADDRESS = addressForPublicKey(ISSUER_PUBLIC_KEY);
const HOLDER = PrivateKey.fromHex('22'.repeat(32));
const HOLDER_PUBLIC_KEY = HOLDER.toPublicKey().toString();
const HOLDER_ADDRESS = addressForPublicKey(HOLDER_PUBLIC_KEY);
const OTHER = PrivateKey.fromHex('33'.repeat(32));

function backend(satoshis: number, options: { broadcastStatus?: number } = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (isChallengeRequest(url)) return challengeResponse();
    if (url.includes('/utxos/')) {
      const utxos = satoshis > 0 ? [{ txid: 'a'.repeat(64), vout: 0, satoshis, height: 100 }] : [];
      return new Response(JSON.stringify({ utxos }), { status: 200 });
    }
    if (url.endsWith('/broadcast')) {
      if (options.broadcastStatus && options.broadcastStatus !== 200) {
        return new Response(JSON.stringify({ error: 'the network rejected it' }), { status: options.broadcastStatus });
      }
      const body = JSON.parse(String(init?.body)) as { rawtx: string };
      return new Response(JSON.stringify({ txid: Transaction.fromHex(body.rawtx).id('hex') }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function broadcastTransactions(fetchImpl: ReturnType<typeof backend>): Transaction[] {
  return fetchImpl.mock.calls
    .filter(([url]) => String(url).endsWith('/broadcast'))
    .map(([, init]) => Transaction.fromHex((JSON.parse(String(init?.body)) as { rawtx: string }).rawtx));
}

const RICH = issueCost().totalSatoshis + 5_000;

describe('issueLicence', () => {
  beforeEach(async () => {
    await db.pendingSpends.clear();
  });

  it('broadcasts one mint to the holder in the chosen collection and records a pending spend', async () => {
    const fetchImpl = backend(RICH);
    const result = await issueLicence({
      holderPublicKeyHex: HOLDER_PUBLIC_KEY,
      collection: 'cairn',
      issuerKey: ISSUER_MASTER,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      provider: new FakeChainProvider(),
    });

    const broadcasts = broadcastTransactions(fetchImpl);
    expect(broadcasts).toHaveLength(1);
    const tx = broadcasts[0];
    expect(result).toEqual({
      txid: tx.id('hex'),
      origin: `${tx.id('hex')}:0`,
      collection: 'cairn',
      holder: HOLDER_ADDRESS,
    });
    expect(tx.outputs[1].satoshis).toBe(chainConfig.mintFuelSatoshis);
    const record = decodeTypedRecordScript(tx.outputs[2].lockingScript);
    expect(record?.recordType).toBe('M');
    expect(JSON.parse(Utils.toUTF8(record!.payloadBytes))).toEqual({ collection: 'cairn', holder: HOLDER_ADDRESS });

    const pending = await db.pendingSpends.toArray();
    expect(pending).toHaveLength(1);
    expect(pending[0].txid).toBe(tx.id('hex'));
    expect(pending[0].outpoints).toEqual([`${'a'.repeat(64)}:0`]);
    expect(pending[0].changeOutpoint).toMatchObject({ txid: tx.id('hex'), vout: 3 });
  });

  it('never talks to the chain provider to broadcast', async () => {
    const provider = new FakeChainProvider();
    const broadcastSpy = vi.spyOn(provider, 'broadcast');
    await issueLicence({
      holderPublicKeyHex: HOLDER_PUBLIC_KEY,
      collection: 'cairn',
      issuerKey: ISSUER_MASTER,
      fetchImpl: backend(RICH) as unknown as typeof fetch,
      provider,
    });
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('refuses my own key before any fetch', async () => {
    const fetchImpl = backend(RICH);
    const attempt = issueLicence({
      holderPublicKeyHex: ISSUER_PUBLIC_KEY,
      collection: 'cairn',
      issuerKey: ISSUER_MASTER,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(attempt).rejects.toMatchObject({ code: 'own-key' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses an invalid key before any fetch', async () => {
    const fetchImpl = backend(RICH);
    for (const bad of ['', 'not a key', '02' + 'ab'.repeat(10), ISSUER_PUBLIC_KEY.toUpperCase().slice(0, 60)]) {
      const attempt = issueLicence({
        holderPublicKeyHex: bad,
        collection: 'cairn',
        issuerKey: ISSUER_MASTER,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      await expect(attempt).rejects.toMatchObject({ code: 'invalid-key' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses an empty collection before any fetch', async () => {
    const fetchImpl = backend(RICH);
    await expect(
      issueLicence({
        holderPublicKeyHex: HOLDER_PUBLIC_KEY,
        collection: '  ',
        issuerKey: ISSUER_MASTER,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(IssueError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('says plainly when there are not enough sats, and broadcasts nothing', async () => {
    for (const balance of [0, issueCost().totalSatoshis - 1]) {
      const fetchImpl = backend(balance);
      const attempt = issueLicence({
        holderPublicKeyHex: HOLDER_PUBLIC_KEY,
        collection: 'cairn',
        issuerKey: ISSUER_MASTER,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        provider: new FakeChainProvider(),
      });
      await expect(attempt).rejects.toMatchObject({ code: 'insufficient-funds', message: expect.stringMatching(/not enough sats/i) });
      expect(broadcastTransactions(fetchImpl)).toHaveLength(0);
    }
    expect(await db.pendingSpends.count()).toBe(0);
  });

  it('reports a rejected broadcast as a network error and records no pending spend', async () => {
    const attempt = issueLicence({
      holderPublicKeyHex: HOLDER_PUBLIC_KEY,
      collection: 'cairn',
      issuerKey: ISSUER_MASTER,
      fetchImpl: backend(RICH, { broadcastStatus: 502 }) as unknown as typeof fetch,
      provider: new FakeChainProvider(),
    });
    await expect(attempt).rejects.toMatchObject({ code: 'network', message: 'the network rejected it' });
    expect(await db.pendingSpends.count()).toBe(0);
  });

  it('reports an unreachable backend as a network error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const attempt = issueLicence({
      holderPublicKeyHex: HOLDER_PUBLIC_KEY,
      collection: 'cairn',
      issuerKey: ISSUER_MASTER,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      provider: new FakeChainProvider(),
    });
    await expect(attempt).rejects.toMatchObject({ code: 'network' });
  });
});

describe('issueCost and fetchIssuerBalance', () => {
  it('is the Fuel plus a fee estimate, and the total covers both', () => {
    const cost = issueCost();
    expect(cost.fuelSatoshis).toBe(chainConfig.mintFuelSatoshis);
    expect(cost.feeEstimateSatoshis).toBeGreaterThan(0);
    expect(cost.totalSatoshis).toBeGreaterThanOrEqual(cost.fuelSatoshis + cost.feeEstimateSatoshis);
  });

  it('sums the issuer coins the backend lists', async () => {
    const balance = await fetchIssuerBalance({ issuerKey: ISSUER_MASTER, fetchImpl: backend(1234) as unknown as typeof fetch });
    expect(balance).toBe(1234);
  });
});

describe('revokeLicence', () => {
  beforeEach(async () => {
    await db.pendingSpends.clear();
  });

  /** A chain holding one mint this key issued; its origin is what a revoke may name. */
  async function chainWithMyMint() {
    const provider = new FakeChainProvider();
    const hex = await signedRecordTxHex(ISSUER, 'M', { collection: 'cairn', holder: HOLDER_ADDRESS }, 0);
    const txid = Transaction.fromHex(hex).id('hex');
    provider.addTransaction(ISSUER_ADDRESS, txid, hex, 200);
    return { provider, origin: `${txid}:0` };
  }

  it('broadcasts a W revoke record naming the origin, signed by my key, and records a pending spend', async () => {
    const { provider, origin } = await chainWithMyMint();
    const fetchImpl = backend(10_000);
    const result = await revokeLicence({
      origin,
      issuerKey: ISSUER_MASTER,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      provider,
    });

    const [tx] = broadcastTransactions(fetchImpl);
    expect(broadcastTransactions(fetchImpl)).toHaveLength(1);
    expect(result.txid).toBe(tx.id('hex'));
    const record = decodeTypedRecordScript(tx.outputs[0].lockingScript);
    expect(record?.recordType).toBe('W');
    expect(JSON.parse(Utils.toUTF8(record!.payloadBytes))).toEqual({ kind: 'revoke', origin });
    const pushed = tx.inputs[0].unlockingScript!.chunks.map((c) => Utils.toHex(c.data ?? []));
    expect(pushed).toContain(ISSUER_PUBLIC_KEY);
    expect(await db.pendingSpends.count()).toBe(1);
  });

  it('refuses a malformed origin before any fetch', async () => {
    const fetchImpl = backend(10_000);
    await expect(
      revokeLicence({ origin: 'nonsense', issuerKey: ISSUER_MASTER, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(IssueError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses an origin that is not one of my own mints, before fetching coins or broadcasting', async () => {
    const { provider } = await chainWithMyMint();
    const fetchImpl = backend(10_000);
    const attempt = revokeLicence({
      origin: `${'c'.repeat(64)}:0`,
      issuerKey: ISSUER_MASTER,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      provider,
    });
    await expect(attempt).rejects.toMatchObject({ message: 'That licence is not one you issued.' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await db.pendingSpends.count()).toBe(0);
  });

  it('says plainly when there are not enough sats', async () => {
    const { provider, origin } = await chainWithMyMint();
    const attempt = revokeLicence({
      origin,
      issuerKey: ISSUER_MASTER,
      fetchImpl: backend(1) as unknown as typeof fetch,
      provider,
    });
    await expect(attempt).rejects.toMatchObject({ code: 'insufficient-funds' });
  });

  describe('when WhatsOnChain is busy on the read of my mints (mw-2f65hu)', () => {
    const RATE_LIMITED = 'WhatsOnChain rate-limited the request (429)';

    beforeEach(() => setBusyRetryDelaysMs([1, 1, 1]));
    afterEach(() => setBusyRetryDelaysMs(undefined));

    it('reads again, says so each time, and then revokes', async () => {
      const { provider, origin } = await chainWithMyMint();
      const read = provider.getAddressHistory.bind(provider);
      let reads = 0;
      provider.getAddressHistory = async (address) => {
        if (++reads <= 2) throw new Error(RATE_LIMITED);
        return read(address);
      };
      const onBusy = vi.fn();
      const fetchImpl = backend(10_000);
      await revokeLicence({ origin, issuerKey: ISSUER_MASTER, fetchImpl: fetchImpl as unknown as typeof fetch, provider, onBusy });
      expect(onBusy).toHaveBeenCalledTimes(2);
      expect(broadcastTransactions(fetchImpl)).toHaveLength(1);
    });

    it('that stays busy ends in one plain line that says nothing was spent, and broadcasts nothing', async () => {
      const { provider, origin } = await chainWithMyMint();
      provider.getAddressHistory = async () => {
        throw new Error(RATE_LIMITED);
      };
      const fetchImpl = backend(10_000);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const attempt = revokeLicence({ origin, issuerKey: ISSUER_MASTER, fetchImpl: fetchImpl as unknown as typeof fetch, provider });
      await expect(attempt).rejects.toMatchObject({
        code: 'network',
        message: 'WhatsOnChain is rate-limiting us. Nothing was spent. Try again in a minute.',
      });
      warn.mockRestore();
      expect(broadcastTransactions(fetchImpl)).toHaveLength(0);
      expect(await db.pendingSpends.count()).toBe(0);
    });
  });
});

describe('issuedLicences', () => {
  async function chainWith(...entries: Array<{ key: PrivateKey; type: 'M' | 'W'; payload: object; vout: number; height?: number }>) {
    const provider = new FakeChainProvider();
    const txids: string[] = [];
    for (const entry of entries) {
      const hex = await signedRecordTxHex(entry.key, entry.type, entry.payload, entry.vout);
      const txid = Transaction.fromHex(hex).id('hex');
      txids.push(txid);
      provider.addTransaction(ISSUER_ADDRESS, txid, hex, entry.height ?? 0);
    }
    return { provider, txids };
  }

  it('lists a mint I signed, with its collection, holder, txid and height', async () => {
    const { provider, txids } = await chainWith({
      key: ISSUER,
      type: 'M',
      payload: { collection: 'cairn', holder: HOLDER_ADDRESS },
      vout: 0,
      height: 200,
    });
    const licences = await issuedLicences({ issuerPublicKeyHex: ISSUER_PUBLIC_KEY, provider });
    expect(licences).toEqual([
      { txid: txids[0], origin: `${txids[0]}:0`, collection: 'cairn', holder: HOLDER_ADDRESS, height: 200, revoked: false },
    ]);
  });

  it('marks it revoked once my W revoke names its origin', async () => {
    const first = await chainWith({ key: ISSUER, type: 'M', payload: { collection: 'cairn', holder: HOLDER_ADDRESS }, vout: 0, height: 200 });
    const origin = `${first.txids[0]}:0`;
    const revokeHex = await signedRecordTxHex(ISSUER, 'W', { kind: 'revoke', origin }, 1);
    first.provider.addTransaction(ISSUER_ADDRESS, Transaction.fromHex(revokeHex).id('hex'), revokeHex, 201);
    const [licence] = await issuedLicences({ issuerPublicKeyHex: ISSUER_PUBLIC_KEY, provider: first.provider });
    expect(licence.revoked).toBe(true);
  });

  it('marks it revoked when the revoke record names its origin in another letter case', async () => {
    const first = await chainWith({ key: ISSUER, type: 'M', payload: { collection: 'cairn', holder: HOLDER_ADDRESS }, vout: 0, height: 200 });
    const origin = `${first.txids[0]}:0`;
    const revokeHex = await signedRecordTxHex(ISSUER, 'W', { kind: 'revoke', origin: origin.toUpperCase() }, 1);
    first.provider.addTransaction(ISSUER_ADDRESS, Transaction.fromHex(revokeHex).id('hex'), revokeHex, 201);
    const [licence] = await issuedLicences({ issuerPublicKeyHex: ISSUER_PUBLIC_KEY, provider: first.provider });
    expect(licence.revoked).toBe(true);
  });

  it('ignores a revoke someone else signed', async () => {
    const { provider, txids } = await chainWith(
      { key: ISSUER, type: 'M', payload: { collection: 'cairn', holder: HOLDER_ADDRESS }, vout: 0, height: 200 },
      { key: OTHER, type: 'W', payload: { kind: 'revoke', origin: 'placeholder' }, vout: 1, height: 201 },
    );
    const forged = await signedRecordTxHex(OTHER, 'W', { kind: 'revoke', origin: `${txids[0]}:0` }, 2);
    provider.addTransaction(ISSUER_ADDRESS, Transaction.fromHex(forged).id('hex'), forged, 202);
    const [licence] = await issuedLicences({ issuerPublicKeyHex: ISSUER_PUBLIC_KEY, provider });
    expect(licence.revoked).toBe(false);
  });

  it('omits mints signed by others', async () => {
    const { provider } = await chainWith({
      key: OTHER,
      type: 'M',
      payload: { collection: 'cairn', holder: ISSUER_ADDRESS },
      vout: 0,
      height: 200,
    });
    expect(await issuedLicences({ issuerPublicKeyHex: ISSUER_PUBLIC_KEY, provider })).toEqual([]);
  });

  it('lists newest first, unconfirmed before confirmed', async () => {
    const { provider, txids } = await chainWith(
      { key: ISSUER, type: 'M', payload: { collection: 'cairn', holder: HOLDER_ADDRESS }, vout: 0, height: 100 },
      { key: ISSUER, type: 'M', payload: { collection: 'ledger', holder: HOLDER_ADDRESS }, vout: 1, height: 300 },
      { key: ISSUER, type: 'M', payload: { collection: 'harbour', holder: HOLDER_ADDRESS }, vout: 2, height: 0 },
    );
    const licences = await issuedLicences({ issuerPublicKeyHex: ISSUER_PUBLIC_KEY, provider });
    expect(licences.map((l) => l.txid)).toEqual([txids[2], txids[1], txids[0]]);
  });

  it('finds a mint still in the mempool', async () => {
    const provider = new FakeChainProvider();
    const hex = await signedRecordTxHex(ISSUER, 'M', { collection: 'cairn', holder: HOLDER_ADDRESS }, 0);
    const txid = Transaction.fromHex(hex).id('hex');
    (provider as ChainProvider).getUnconfirmedAddressHistory = async () => [{ txid, height: 0 }];
    provider.addTransaction('someone-else', txid, hex);
    const licences = await issuedLicences({ issuerPublicKeyHex: ISSUER_PUBLIC_KEY, provider });
    expect(licences.map((l) => l.txid)).toEqual([txid]);
  });
});

describe('the whole paged history of a key that has passed 100 transactions (mw-yjxcw.10)', () => {
  const CONFIRMED = `/v1/bsv/test/address/${ISSUER_ADDRESS}/confirmed/history`;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Serves WhatsOnChain's paged /confirmed/history (newest page first), an empty /unconfirmed/history and /tx/<id>/hex. */
  function stubWhatsOnChain(pages: Array<Array<{ tx_hash: string; height: number }>>, hexByTxid: Record<string, string> = {}) {
    const requested: string[] = [];
    const stub = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requested.push(url.pathname + url.search);
      if (url.pathname.endsWith('/confirmed/history')) {
        const token = url.searchParams.get('token');
        const index = token === null ? 0 : Number(token.replace('page-', ''));
        const more = index + 1 < pages.length;
        return new Response(JSON.stringify({ result: pages[index], nextPageToken: more ? `page-${index + 1}` : '', error: '' }), { status: 200 });
      }
      if (url.pathname.endsWith('/unconfirmed/history')) {
        return new Response(JSON.stringify({ result: [], nextPageToken: '', error: '' }), { status: 200 });
      }
      const hexMatch = /\/tx\/([0-9a-f]{64})\/hex$/.exec(url.pathname);
      if (hexMatch && hexByTxid[hexMatch[1]]) return new Response(hexByTxid[hexMatch[1]], { status: 200 });
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', stub);
    return { requested, stub };
  }

  async function oldestPageMint() {
    const mintHex = await signedRecordTxHex(ISSUER, 'M', { collection: 'cairn', holder: HOLDER_ADDRESS }, 0);
    const otherHex = await signedRecordTxHex(OTHER, 'M', { collection: 'cairn', holder: ISSUER_ADDRESS }, 1);
    const mintTxid = Transaction.fromHex(mintHex).id('hex');
    const otherTxid = Transaction.fromHex(otherHex).id('hex');
    // WhatsOnChain gives the newest page first: the mint is on the third (oldest) page.
    const pages = [[{ tx_hash: otherTxid, height: 300 }], [{ tx_hash: otherTxid, height: 250 }], [{ tx_hash: mintTxid, height: 100 }]];
    return { pages, mintTxid, hexByTxid: { [mintTxid]: mintHex, [otherTxid]: otherHex } };
  }

  it('lists a mint that sits on the oldest of three confirmed pages, following nextPageToken', async () => {
    const { pages, mintTxid, hexByTxid } = await oldestPageMint();
    const { requested } = stubWhatsOnChain(pages, hexByTxid);
    const licences = await issuedLicences({ issuerPublicKeyHex: ISSUER_PUBLIC_KEY });
    expect(licences.map((l) => l.txid)).toEqual([mintTxid]);
    expect(requested.filter((path) => path.startsWith(CONFIRMED))).toEqual([
      CONFIRMED,
      `${CONFIRMED}?token=page-1`,
      `${CONFIRMED}?token=page-2`,
    ]);
  });

  it('errors, and never returns a short list, when the history runs past 50 pages', async () => {
    const endless = Array.from({ length: 51 }, () => [{ tx_hash: 'e'.repeat(64), height: 5 }]);
    const { requested } = stubWhatsOnChain(endless);
    const attempt = issuedLicences({ issuerPublicKeyHex: ISSUER_PUBLIC_KEY });
    await expect(attempt).rejects.toMatchObject({ code: 'network', message: expect.stringMatching(/50 pages/) });
    expect(requested.filter((path) => path.startsWith(CONFIRMED))).toHaveLength(50);
  });

  it('errors when WhatsOnChain answers a page with an error field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ result: [], nextPageToken: '', error: 'address is not valid' }), { status: 200 })),
    );
    const attempt = issuedLicences({ issuerPublicKeyHex: ISSUER_PUBLIC_KEY });
    await expect(attempt).rejects.toMatchObject({ code: 'network', message: expect.stringMatching(/address is not valid/) });
  });

  it('does not refuse to revoke that oldest-page licence as not issued', async () => {
    const { pages, mintTxid, hexByTxid } = await oldestPageMint();
    stubWhatsOnChain(pages, hexByTxid);
    const backendFetch = backend(10_000);
    const result = await revokeLicence({
      origin: `${mintTxid}:0`,
      issuerKey: ISSUER_MASTER,
      fetchImpl: backendFetch as unknown as typeof fetch,
    });
    expect(result.txid).toBe(broadcastTransactions(backendFetch)[0].id('hex'));
  });
});
