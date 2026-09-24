import { PrivateKey } from '@bsv/sdk';
import { chainConfig } from 'spell-forge-bsv';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/db';
import { addressForPublicKey, checkLicence, findLicence, getCachedLicenceStatus } from '../../src/services/licence';
import { FakeChainProvider } from '../support/fake-chain-provider';
import { mintRecordTxHex, transferRecordTxHex } from '../support/nftgate-fixtures';

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
    expect(await findLicence(PUBLIC_KEY_HEX, provider)).toEqual({ txid, vout: 0 });
  });

  it('treats a transferred-away token as no longer held', async () => {
    const provider = new FakeChainProvider();
    const mintTxid = 'c'.repeat(64);
    provider.addTransaction(ADDRESS, mintTxid, mintRecordTxHex(chainConfig.collectionId, ADDRESS));
    provider.addTransaction(ADDRESS, 'd'.repeat(64), transferRecordTxHex(`${mintTxid}:0`, 'mzSomeoneElseAddress'));
    expect(await findLicence(PUBLIC_KEY_HEX, provider)).toBeNull();
  });

  it('caches the checked result and its time', async () => {
    const provider = new FakeChainProvider();
    const txid = 'e'.repeat(64);
    provider.addTransaction(ADDRESS, txid, mintRecordTxHex(chainConfig.collectionId, ADDRESS));

    const before = Date.now();
    const status = await checkLicence(PUBLIC_KEY_HEX, provider);
    expect(status).toMatchObject({ held: true, outpoint: { txid, vout: 0 } });
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
