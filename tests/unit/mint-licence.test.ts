import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrivateKey, Transaction, P2PKH, Utils } from '@bsv/sdk';
import { chainConfig, encodeTypedRecordScript, type ChainConfig, type ChainProvider } from 'spell-forge-bsv';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { findLicence } from '../../src/services/licence';
import { addressForPublicKey, mintCostSatoshis, runCli } from '../../scripts/mint/lib.mjs';
import { FakeChainProvider } from '../support/fake-chain-provider';

const KEY = PrivateKey.fromHex('66'.repeat(32));
const WIF = KEY.toWif([0xef]);
const PUBLIC_KEY_HEX = KEY.toPublicKey().toString();
const ADDRESS = addressForPublicKey(PUBLIC_KEY_HEX);
const COST = mintCostSatoshis(chainConfig);

function jsonBytes(value: unknown): number[] {
  return Utils.toArray(JSON.stringify(value), 'utf8');
}

/** Stands in for spell-forge-bsv's buildContractMintTransaction (which cannot run under
 * vitest, mw-1589l.3): funds a real, signed transaction from the given UTXOs with a real
 * type-M Data output at index 2, so findLicence can decode it exactly as it would a real mint. */
async function buildTestMintTransaction({
  issuerKey,
  utxos,
  holderPubKey,
  config,
  provider,
}: {
  issuerKey: string;
  utxos: { txid: string; vout: number; satoshis: number }[];
  holderPubKey: string;
  config: ChainConfig;
  provider: ChainProvider;
}) {
  const issuer = PrivateKey.fromWif(issuerKey);
  const holderAddress = addressForPublicKey(holderPubKey, config);
  const transaction = new Transaction();
  for (const utxo of utxos) {
    const sourceHex = await provider.getTransactionHex(utxo.txid);
    transaction.addInput({
      sourceTransaction: Transaction.fromHex(sourceHex),
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(issuer),
    });
  }
  transaction.addOutput({ lockingScript: new P2PKH().lock(holderAddress), satoshis: 1 });
  transaction.addOutput({ lockingScript: new P2PKH().lock(holderAddress), satoshis: config.mintFuelSatoshis ?? 0 });
  transaction.addOutput({
    lockingScript: encodeTypedRecordScript('M', jsonBytes({ collection: config.collectionId, holder: holderAddress })),
    satoshis: 0,
  });
  transaction.addOutput({ lockingScript: new P2PKH().lock(issuer.toAddress(config.network)), change: true });
  await transaction.fee();
  await transaction.sign();
  return { hex: transaction.toHex(), txid: transaction.id('hex'), transaction };
}

function fundingUtxo(provider: FakeChainProvider, address: string, satoshis: number) {
  const fundingTx = new Transaction();
  fundingTx.addOutput({ lockingScript: new P2PKH().lock(address), satoshis });
  const hex = fundingTx.toHex();
  const txid = fundingTx.id('hex');
  provider.addTransaction(address, txid, hex);
  return { txid, vout: 0, satoshis };
}

describe('scripts/mint/lib.mjs mintCostSatoshis / addressForPublicKey', () => {
  it('addressForPublicKey agrees with licence.ts addressForPublicKey', () => {
    expect(ADDRESS).toBe(addressForPublicKey(PUBLIC_KEY_HEX, chainConfig));
  });
});

describe('runCli --dry-run (AC1)', () => {
  let keyFile: string;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mint-licence-'));
    keyFile = join(dir, 'key.wif');
    writeFileSync(keyFile, `${WIF}\n`);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('prints the address, balance, cost and hex, and never broadcasts', async () => {
    const provider = new FakeChainProvider();
    provider.setUtxos(ADDRESS, [fundingUtxo(provider, ADDRESS, COST + 5_000)]);
    const broadcastSpy = vi.spyOn(provider, 'broadcast');
    const buildMint = vi.fn().mockResolvedValue({ hex: 'deadbeef', txid: 'unused' });
    const lines: string[] = [];

    const exitCode = await runCli(['--key-file', keyFile, '--dry-run'], {
      provider,
      config: chainConfig,
      buildMint,
      log: (line: string) => lines.push(line),
    });

    expect(exitCode).toBe(0);
    expect(lines.some((line) => line.includes(ADDRESS))).toBe(true);
    expect(lines.some((line) => line.includes(String(COST + 5_000)))).toBe(true);
    expect(lines.some((line) => line.includes(String(COST)))).toBe(true);
    expect(lines.some((line) => line.includes('deadbeef'))).toBe(true);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });
});

describe('runCli without --dry-run (AC2)', () => {
  let keyFile: string;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mint-licence-'));
    keyFile = join(dir, 'key.wif');
    writeFileSync(keyFile, `${WIF}\n`);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('broadcasts a real mint whose output 0 is the token and whose records findLicence finds held', async () => {
    const provider = new FakeChainProvider();
    provider.setUtxos(ADDRESS, [fundingUtxo(provider, ADDRESS, COST + 5_000)]);
    // FakeChainProvider.broadcast() normally returns a fixed txid with no history side
    // effect; here it stands in for the chain actually indexing the broadcast transaction,
    // tying the txid to the real signed hex the builder produced.
    let broadcastTxid: string | undefined;
    (provider as ChainProvider).broadcast = async (hex: string) => {
      const txid = Transaction.fromHex(hex).id('hex');
      provider.addTransaction(ADDRESS, txid, hex);
      broadcastTxid = txid;
      return txid;
    };
    const lines: string[] = [];

    const exitCode = await runCli(['--key-file', keyFile], {
      provider,
      config: chainConfig,
      buildMint: buildTestMintTransaction,
      log: (line: string) => lines.push(line),
    });

    expect(exitCode).toBe(0);
    const txidLine = lines.find((line) => line.toLowerCase().includes('txid'));
    expect(txidLine).toBeDefined();
    expect(broadcastTxid).toBeDefined();

    const licence = await findLicence(PUBLIC_KEY_HEX, provider);
    expect(licence).toEqual({ txid: broadcastTxid, vout: 0 });
  });
});

describe('runCli balance below cost (AC3)', () => {
  let keyFile: string;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mint-licence-'));
    keyFile = join(dir, 'key.wif');
    writeFileSync(keyFile, `${WIF}\n`);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits 1 naming the balance, cost and shortfall, and never broadcasts', async () => {
    const provider = new FakeChainProvider();
    const shortBalance = COST - 100;
    provider.setUtxos(ADDRESS, [fundingUtxo(provider, ADDRESS, shortBalance)]);
    const broadcastSpy = vi.spyOn(provider, 'broadcast');
    const buildMint = vi.fn();
    const errors: string[] = [];

    const exitCode = await runCli(['--key-file', keyFile], {
      provider,
      config: chainConfig,
      buildMint,
      log: () => {},
      errorLog: (line: string) => errors.push(line),
    });

    expect(exitCode).toBe(1);
    expect(errors.some((line) => line.includes(String(shortBalance)))).toBe(true);
    expect(errors.some((line) => line.includes(String(COST)))).toBe(true);
    expect(errors.some((line) => line.includes('short 100 sat'))).toBe(true);
    expect(broadcastSpy).not.toHaveBeenCalled();
    expect(buildMint).not.toHaveBeenCalled();
  });
});

describe('runCli key file problems (AC4)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mint-licence-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits 1 for a missing key file, without ever printing a WIF', async () => {
    const provider = new FakeChainProvider();
    const errors: string[] = [];

    const exitCode = await runCli(['--key-file', join(dir, 'does-not-exist.wif')], {
      provider,
      config: chainConfig,
      buildMint: vi.fn(),
      log: () => {},
      errorLog: (line: string) => errors.push(line),
    });

    expect(exitCode).toBe(1);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((line) => line.includes(WIF))).toBe(false);
  });

  it('exits 1 for an unreadable key file (a directory), without ever printing a WIF', async () => {
    const provider = new FakeChainProvider();
    const errors: string[] = [];

    const exitCode = await runCli(['--key-file', dir], {
      provider,
      config: chainConfig,
      buildMint: vi.fn(),
      log: () => {},
      errorLog: (line: string) => errors.push(line),
    });

    expect(exitCode).toBe(1);
    expect(errors.some((line) => line.includes(WIF))).toBe(false);
  });

  it('exits 1 for a malformed key file, without ever printing its content', async () => {
    const provider = new FakeChainProvider();
    const keyFile = join(dir, 'key.wif');
    writeFileSync(keyFile, 'not-a-valid-wif\n');
    const errors: string[] = [];

    const exitCode = await runCli(['--key-file', keyFile], {
      provider,
      config: chainConfig,
      buildMint: vi.fn(),
      log: () => {},
      errorLog: (line: string) => errors.push(line),
    });

    expect(exitCode).toBe(1);
    expect(errors.some((line) => line.includes('not-a-valid-wif'))).toBe(false);
  });
});
