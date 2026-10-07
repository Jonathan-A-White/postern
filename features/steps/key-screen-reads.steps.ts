// features/steps/key-screen-reads.steps.ts — runs features/key-screen-reads.feature (mw-nlxylg):
// the three reads the Key screen makes (balance, licence check, Issued licences) through the
// chain door, over a WhatsOnChain double that records every request. Counted in docs/key-screen-reads.md.
import { PrivateKey, Transaction } from '@bsv/sdk';
import { expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { db } from '../../src/data/db';
import { chain } from '../../src/chain';
import { addressForPublicKey } from '../../src/services/licence';
import { setChainReadGapMs } from '../../src/services/chainPacer';
import { resetSharedChainReads } from '../../src/services/sharedChainReads';
import { signedRecordTxHex } from '../../tests/support/nftgate-fixtures';
import { wocStub, type WocStub } from '../../tests/support/woc-stub';

const KEY = PrivateKey.fromHex('11'.repeat(32));
const PUBLIC_KEY_HEX = KEY.toPublicKey().toString();
const HOLDER_ADDRESS = addressForPublicKey(PrivateKey.fromHex('22'.repeat(32)).toPublicKey().toString());

let stub: WocStub;
let txids: string[];
let asked: string[];

async function openKeyScreen(): Promise<PromiseSettledResult<unknown>[]> {
  return Promise.allSettled([
    chain.balance(PUBLIC_KEY_HEX),
    chain.checkLicence(PUBLIC_KEY_HEX),
    chain.issuedLicences({ issuerPublicKeyHex: PUBLIC_KEY_HEX }),
  ]);
}

async function keyWithTransactions(count: number): Promise<void> {
  const hexByTxid: Record<string, string> = {};
  const entries: Array<{ tx_hash: string; height: number }> = [];
  for (let i = 0; i < count; i++) {
    const hex = await signedRecordTxHex(KEY, 'M', { collection: i === 0 ? 'postern' : `other-${i}`, holder: HOLDER_ADDRESS }, i);
    const txid = Transaction.fromHex(hex).id('hex');
    hexByTxid[txid] = hex;
    entries.push({ tx_hash: txid, height: 100 + i });
  }
  txids = entries.map((entry) => entry.tx_hash);
  stub = wocStub({ pages: [entries], hexByTxid, balance: 20_000 });
  vi.stubGlobal('fetch', stub.fetchImpl);
}

const feature = await loadFeature('features/key-screen-reads.feature');

describeFeature(feature, ({ BeforeEachScenario, AfterEachScenario, Scenario }) => {
  // Each step is its own vitest test, so the scenario hooks, not beforeEach, bracket a scenario.
  BeforeEachScenario(async () => {
    await db.settings.clear();
    resetSharedChainReads();
    setChainReadGapMs(0);
  });
  AfterEachScenario(() => {
    vi.unstubAllGlobals();
  });

  Scenario("mw-nlxylg AC-2: opening the Key screen reads each address list and each transaction once", ({ Given, When, Then, And }) => {
    Given("a key whose address holds 5 transactions on one page of WhatsOnChain's history", () => keyWithTransactions(5));
    When('the Key screen is opened', async () => {
      await openKeyScreen();
    });
    Then('WhatsOnChain was asked 8 times: the coins, both address lists and the 5 transactions', () => {
      expect(stub.requested).toHaveLength(8);
    });
    And('no address list and no transaction was asked for twice', () => {
      expect(new Set(stub.requested).size).toBe(stub.requested.length);
    });
  });

  Scenario('mw-nlxylg AC-2b: opening the Key screen again asks for no transaction a second time', ({ Given, When, Then, And }) => {
    Given("a key whose address holds 5 transactions on one page of WhatsOnChain's history", () => keyWithTransactions(5));
    And('the Key screen was opened', async () => {
      await openKeyScreen();
    });
    When('the Key screen is opened again', async () => {
      stub.requested.length = 0;
      await openKeyScreen();
    });
    Then('WhatsOnChain was asked 3 times: the coins and both address lists', () => {
      expect(stub.requested).toHaveLength(3);
      expect(stub.requested.some((path) => path.endsWith('/hex'))).toBe(false);
    });
  });

  Scenario('mw-nlxylg AC-2c: a transaction that could not be read is asked for again, the others are not', ({ Given, When, Then, And }) => {
    Given("a key whose address holds 5 transactions on one page of WhatsOnChain's history", () => keyWithTransactions(5));
    And('WhatsOnChain cannot give one of the transactions', () => {
      stub.failingHex.add(txids[2]);
    });
    And('the Key screen was opened', async () => {
      await openKeyScreen();
    });
    When('WhatsOnChain can give it again and the Issued licences are retried', async () => {
      stub.failingHex.clear();
      stub.requested.length = 0;
      await chain.issuedLicences({ issuerPublicKeyHex: PUBLIC_KEY_HEX });
      asked = stub.requested.filter((path) => path.endsWith('/hex'));
    });
    Then('only the transaction that failed, and the ones not yet read, are asked for', () => {
      expect(asked).toContain(`/v1/bsv/test/tx/${txids[2]}/hex`);
      expect(asked.length).toBeLessThan(5);
    });
  });
});
