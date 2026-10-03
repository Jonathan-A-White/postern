import { PrivateKey, Utils } from '@bsv/sdk';
import { chainConfig, findTypedRecordsInTransaction } from 'spell-forge-bsv';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../src/data/db';
import { addressForPublicKey, checkLicence, findLicence, getCachedLicenceStatus } from '../../src/services/licence';
import { COCKPIT_COLLECTION, LEGACY_LICENCE_COLLECTION } from '../../src/services/collections';
import { FakeChainProvider } from '../support/fake-chain-provider';
import { mintRecordTxHex, revokeRecordTxHex, transferRecordTxHex } from '../support/nftgate-fixtures';

const KEY = PrivateKey.fromHex('11'.repeat(32));
const PUBLIC_KEY_HEX = KEY.toPublicKey().toString();
const ADDRESS = KEY.toPublicKey().toAddress('testnet');

describe('licence', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('derives the testnet address from the vault public key', () => {
    expect(addressForPublicKey(PUBLIC_KEY_HEX)).toBe(ADDRESS);
  });

  it('finds no licence when the address has no history', async () => {
    const provider = new FakeChainProvider();
    expect(await findLicence(PUBLIC_KEY_HEX, provider)).toBeNull();
  });

  it('finds no licence when the address has unrelated history', async () => {
    const provider = new FakeChainProvider();
    provider.addTransaction(ADDRESS, 'a'.repeat(64), mintRecordTxHex('some-other-collection', ADDRESS));
    expect(await findLicence(PUBLIC_KEY_HEX, provider)).toBeNull();
  });

  it('finds the licence at vout 0 of a matching mint transaction', async () => {
    const provider = new FakeChainProvider();
    const txid = 'b'.repeat(64);
    provider.addTransaction(ADDRESS, txid, mintRecordTxHex(chainConfig.collectionId, ADDRESS));
    expect(await findLicence(PUBLIC_KEY_HEX, provider)).toEqual({ txid, vout: 0, collection: chainConfig.collectionId });
  });

  it("finds a mint in the cockpit collection 'postern'", async () => {
    const provider = new FakeChainProvider();
    const txid = 'f'.repeat(64);
    provider.addTransaction(ADDRESS, txid, mintRecordTxHex('postern', ADDRESS));
    expect(await findLicence(PUBLIC_KEY_HEX, provider)).toEqual({ txid, vout: 0, collection: 'postern' });
  });

  it("still finds a mint in the old collection 'spellforge-leaderboard-testnet' (mw-6ww.63 transition)", async () => {
    const provider = new FakeChainProvider();
    const txid = '1'.repeat(64);
    provider.addTransaction(ADDRESS, txid, mintRecordTxHex('spellforge-leaderboard-testnet', ADDRESS));
    expect(await findLicence(PUBLIC_KEY_HEX, provider)).toEqual({
      txid,
      vout: 0,
      collection: 'spellforge-leaderboard-testnet',
    });
  });

  it("prefers a mint in 'postern' over one in the old collection, the old one first in the history", async () => {
    const provider = new FakeChainProvider();
    const legacyTxid = '3'.repeat(64);
    const posternTxid = '4'.repeat(64);
    provider.addTransaction(ADDRESS, legacyTxid, mintRecordTxHex(LEGACY_LICENCE_COLLECTION, ADDRESS));
    provider.addTransaction(ADDRESS, posternTxid, mintRecordTxHex(COCKPIT_COLLECTION, ADDRESS));
    expect(await findLicence(PUBLIC_KEY_HEX, provider)).toEqual({ txid: posternTxid, vout: 0, collection: 'postern' });
  });

  it("prefers a mint in 'postern' over one in the old collection, the old one last in the history", async () => {
    const provider = new FakeChainProvider();
    const legacyTxid = '5'.repeat(64);
    const posternTxid = '6'.repeat(64);
    provider.addTransaction(ADDRESS, posternTxid, mintRecordTxHex(COCKPIT_COLLECTION, ADDRESS));
    provider.addTransaction(ADDRESS, legacyTxid, mintRecordTxHex(LEGACY_LICENCE_COLLECTION, ADDRESS));
    expect(await findLicence(PUBLIC_KEY_HEX, provider)).toEqual({ txid: posternTxid, vout: 0, collection: 'postern' });
  });

  it("falls back to the old collection's mint when the 'postern' mint was transferred away", async () => {
    const provider = new FakeChainProvider();
    const legacyTxid = '7'.repeat(64);
    const posternTxid = '8'.repeat(64);
    provider.addTransaction(ADDRESS, legacyTxid, mintRecordTxHex(LEGACY_LICENCE_COLLECTION, ADDRESS));
    provider.addTransaction(ADDRESS, posternTxid, mintRecordTxHex(COCKPIT_COLLECTION, ADDRESS));
    provider.addTransaction(ADDRESS, '9'.repeat(64), transferRecordTxHex(`${posternTxid}:0`, 'mzSomeoneElseAddress'));
    expect(await findLicence(PUBLIC_KEY_HEX, provider)).toEqual({
      txid: legacyTxid,
      vout: 0,
      collection: LEGACY_LICENCE_COLLECTION,
    });
  });

  it("ignores a mint in another app's collection, 'cairn'", async () => {
    const provider = new FakeChainProvider();
    provider.addTransaction(ADDRESS, '2'.repeat(64), mintRecordTxHex('cairn', ADDRESS));
    expect(await findLicence(PUBLIC_KEY_HEX, provider)).toBeNull();
  });

  it('treats a transferred-away token as no longer held', async () => {
    const provider = new FakeChainProvider();
    const mintTxid = 'c'.repeat(64);
    provider.addTransaction(ADDRESS, mintTxid, mintRecordTxHex(chainConfig.collectionId, ADDRESS));
    provider.addTransaction(ADDRESS, 'd'.repeat(64), transferRecordTxHex(`${mintTxid}:0`, 'mzSomeoneElseAddress'));
    expect(await findLicence(PUBLIC_KEY_HEX, provider)).toBeNull();
  });

  it('has a revoke fixture that decodes as a W record naming the origin', () => {
    const origin = `${'c'.repeat(64)}:0`;
    const records = findTypedRecordsInTransaction(revokeRecordTxHex(origin));
    expect(records).toHaveLength(1);
    expect(records[0].recordType).toBe('W');
    expect(JSON.parse(Utils.toUTF8(records[0].payloadBytes))).toEqual({ kind: 'revoke', origin });
  });

  it('caches the checked result and its time', async () => {
    const provider = new FakeChainProvider();
    const txid = 'e'.repeat(64);
    provider.addTransaction(ADDRESS, txid, mintRecordTxHex(chainConfig.collectionId, ADDRESS));

    const before = Date.now();
    const status = await checkLicence(PUBLIC_KEY_HEX, provider);
    expect(status).toMatchObject({ held: true, outpoint: { txid, vout: 0 }, collection: chainConfig.collectionId });
    expect(Date.parse(status.checkedAt)).toBeGreaterThanOrEqual(before);

    const cached = await getCachedLicenceStatus();
    expect(cached).toEqual(status);
  });

  it('caches a not-held result too', async () => {
    const provider = new FakeChainProvider();
    const status = await checkLicence(PUBLIC_KEY_HEX, provider);
    expect(status.held).toBe(false);
    expect(await getCachedLicenceStatus()).toEqual(status);
  });
});

describe('a key whose history runs past 100 transactions after its mint', () => {
  const CONFIRMED = `/v1/bsv/test/address/${ADDRESS}/confirmed/history`;
  const MINT_TXID = 'a1'.repeat(32);
  const TRANSFER_TXID = 'b2'.repeat(32);
  const OTHER_TXID = 'c3'.repeat(32);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** WhatsOnChain's paged /confirmed/history (newest page first), an empty /unconfirmed/history and /tx/<id>/hex. */
  function stubWhatsOnChain(pages: Array<Array<{ tx_hash: string; height: number }>>, hexByTxid: Record<string, string>) {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        requested.push(url.pathname + url.search);
        if (url.pathname.endsWith('/confirmed/history')) {
          const token = url.searchParams.get('token');
          const index = token === null ? 0 : Number(token.replace('page-', ''));
          const more = index + 1 < pages.length;
          return new Response(JSON.stringify({ result: pages[index], nextPageToken: more ? `page-${index + 1}` : '', error: '' }), {
            status: 200,
          });
        }
        if (url.pathname.endsWith('/unconfirmed/history')) {
          return new Response(JSON.stringify({ result: [], nextPageToken: '', error: '' }), { status: 200 });
        }
        const hexMatch = /\/tx\/([0-9a-f]{64})\/hex$/.exec(url.pathname);
        if (hexMatch && hexByTxid[hexMatch[1]]) return new Response(hexByTxid[hexMatch[1]], { status: 200 });
        return new Response('not found', { status: 404 });
      }),
    );
    return requested;
  }

  /** 100 transactions that are not the licence, as a full first page holds. */
  const fullPage = () => Array.from({ length: 100 }, () => ({ tx_hash: OTHER_TXID, height: 300 }));
  const otherHex = mintRecordTxHex('some-other-collection', ADDRESS);

  it('finds the licence when its mint is on page 2 of the confirmed history', async () => {
    const requested = stubWhatsOnChain([fullPage(), [{ tx_hash: MINT_TXID, height: 100 }]], {
      [MINT_TXID]: mintRecordTxHex(chainConfig.collectionId, ADDRESS),
      [OTHER_TXID]: otherHex,
    });
    expect(await findLicence(PUBLIC_KEY_HEX, undefined, { historyPageDelayMs: 0 })).toEqual({
      txid: MINT_TXID,
      vout: 0,
      collection: chainConfig.collectionId,
    });
    expect(requested.filter((path) => path.startsWith(CONFIRMED))).toEqual([CONFIRMED, `${CONFIRMED}?token=page-1`]);
  });

  it('finds no licence when a transfer of that mint is on page 1 and the mint on page 2', async () => {
    stubWhatsOnChain([[{ tx_hash: TRANSFER_TXID, height: 300 }], [{ tx_hash: MINT_TXID, height: 100 }]], {
      [MINT_TXID]: mintRecordTxHex(chainConfig.collectionId, ADDRESS),
      [TRANSFER_TXID]: transferRecordTxHex(`${MINT_TXID}:0`, 'mzSomeoneElseAddress'),
    });
    expect(await findLicence(PUBLIC_KEY_HEX, undefined, { historyPageDelayMs: 0 })).toBeNull();
  });

  it('stops paging at 50 pages and does not read the key as unlicensed', async () => {
    const endless = Array.from({ length: 51 }, () => [{ tx_hash: OTHER_TXID, height: 5 }]);
    const requested = stubWhatsOnChain(endless, { [OTHER_TXID]: otherHex });
    await expect(findLicence(PUBLIC_KEY_HEX, undefined, { historyPageDelayMs: 0 })).rejects.toThrow(/50 pages/);
    expect(requested.filter((path) => path.startsWith(CONFIRMED))).toHaveLength(50);
  });
});
