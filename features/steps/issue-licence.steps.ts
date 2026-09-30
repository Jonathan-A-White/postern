// features/steps/issue-licence.steps.ts — runs features/issue-licence.feature under vitest
// via @amiceli/vitest-cucumber. Exercises src/services/issue.ts directly. The contract
// mint builder is stood in for by tests/support/fake-mint-builder.ts (the real one cannot
// load under vitest); everything else — the backend calls, the transaction, the pending
// spend, the chain walk — is the real code.
import { expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, Transaction, Utils } from '@bsv/sdk';
import { decodeTypedRecordScript } from 'spell-forge-bsv';
import { db } from '../../src/data/db';
import { addressForPublicKey } from '../../src/services/licence';
import {
  issueCost,
  issueLicence,
  issuedLicences,
  revokeLicence,
  type IssuedLicenceEntry,
} from '../../src/services/issue';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';
import { FakeChainProvider } from '../../tests/support/fake-chain-provider';
import { signedRecordTxHex } from '../../tests/support/nftgate-fixtures';

vi.mock('spell-forge-bsv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('spell-forge-bsv')>();
  const { createFakeMintBuilder } = await import('../../tests/support/fake-mint-builder');
  return { ...actual, buildContractMintTransaction: createFakeMintBuilder(actual.encodeTypedRecordScript) };
});

const feature = await loadFeature('features/issue-licence.feature');

const ISSUER = PrivateKey.fromHex('11'.repeat(32));
const ISSUER_MASTER = new Uint8Array(ISSUER.toArray('be', 32));
const ISSUER_PUBLIC_KEY = ISSUER.toPublicKey().toString();
const ISSUER_ADDRESS = addressForPublicKey(ISSUER_PUBLIC_KEY);
const HOLDER = PrivateKey.fromHex('22'.repeat(32));
const HOLDER_PUBLIC_KEY = HOLDER.toPublicKey().toString();
const HOLDER_ADDRESS = addressForPublicKey(HOLDER_PUBLIC_KEY);
const OTHER = PrivateKey.fromHex('33'.repeat(32));

function backendWith(satoshis: number) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (isChallengeRequest(url)) return challengeResponse();
    if (url.includes('/utxos/')) {
      return new Response(JSON.stringify({ utxos: [{ txid: 'a'.repeat(64), vout: 0, satoshis, height: 100 }] }), { status: 200 });
    }
    if (url.endsWith('/broadcast')) {
      const body = JSON.parse(String(init?.body)) as { rawtx: string };
      return new Response(JSON.stringify({ txid: Transaction.fromHex(body.rawtx).id('hex') }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function broadcasts(fetchImpl: ReturnType<typeof backendWith>): Transaction[] {
  return fetchImpl.mock.calls
    .filter(([url]) => String(url).endsWith('/broadcast'))
    .map(([, init]) => Transaction.fromHex((JSON.parse(String(init?.body)) as { rawtx: string }).rawtx));
}

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  let fetchImpl: ReturnType<typeof backendWith>;
  let outcome: { error?: { code?: string; message: string } };

  BeforeEachScenario(async () => {
    await db.pendingSpends.clear();
    outcome = {};
  });

  const asFetch = () => fetchImpl as unknown as typeof fetch;
  const capture = async (work: Promise<unknown>) => {
    try {
      await work;
    } catch (error) {
      outcome.error = error as { code?: string; message: string };
    }
  };

  Scenario('AC1: issuing to a valid key in cairn broadcasts one mint and records a pending spend', ({ Given, When, Then, And }) => {
    Given('I hold enough sats to issue a licence', () => {
      fetchImpl = backendWith(issueCost().totalSatoshis + 5_000);
    });
    When('I issue a licence to a valid key in cairn', async () => {
      await capture(
        issueLicence({ holderPublicKeyHex: HOLDER_PUBLIC_KEY, collection: 'cairn', issuerKey: ISSUER_MASTER, fetchImpl: asFetch(), provider: new FakeChainProvider() }),
      );
    });
    Then('one transaction is broadcast through the backend', () => {
      expect(outcome.error).toBeUndefined();
      expect(broadcasts(fetchImpl)).toHaveLength(1);
    });
    And('its output 0 is a licence to that key', () => {
      const [tx] = broadcasts(fetchImpl);
      expect(tx.outputs[0].satoshis).toBe(1);
      expect(tx.outputs[0].lockingScript.toHex()).toContain(Utils.toHex(new Uint8Array(HOLDER.toPublicKey().toHash() as number[])));
    });
    And("its mint record names cairn and that key's address", () => {
      const [tx] = broadcasts(fetchImpl);
      const record = decodeTypedRecordScript(tx.outputs[2].lockingScript);
      expect(record?.recordType).toBe('M');
      expect(JSON.parse(Utils.toUTF8(record!.payloadBytes))).toEqual({ collection: 'cairn', holder: HOLDER_ADDRESS });
    });
    And('the spend is remembered as pending', async () => {
      const [tx] = broadcasts(fetchImpl);
      const pending = await db.pendingSpends.toArray();
      expect(pending.map((p) => p.txid)).toEqual([tx.id('hex')]);
    });
  });

  Scenario('AC2: issuing to my own key is refused before anything is fetched', ({ Given, When, Then, And }) => {
    Given('I hold enough sats to issue a licence', () => {
      fetchImpl = backendWith(issueCost().totalSatoshis + 5_000);
    });
    When('I issue a licence to my own key', async () => {
      await capture(issueLicence({ holderPublicKeyHex: ISSUER_PUBLIC_KEY, collection: 'cairn', issuerKey: ISSUER_MASTER, fetchImpl: asFetch() }));
    });
    Then('it is refused as my own key', () => {
      expect(outcome.error?.code).toBe('own-key');
    });
    And('nothing was fetched', () => {
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  Scenario('AC3: an invalid key is refused', ({ Given, When, Then, And }) => {
    Given('I hold enough sats to issue a licence', () => {
      fetchImpl = backendWith(issueCost().totalSatoshis + 5_000);
    });
    When('I issue a licence to something that is not a public key', async () => {
      await capture(issueLicence({ holderPublicKeyHex: 'not a public key', collection: 'cairn', issuerKey: ISSUER_MASTER, fetchImpl: asFetch() }));
    });
    Then('it is refused as an invalid key', () => {
      expect(outcome.error?.code).toBe('invalid-key');
    });
    And('nothing was fetched', () => {
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  Scenario('AC4: not enough sats is a clear error', ({ Given, When, Then, And }) => {
    Given('I hold too few sats to issue a licence', () => {
      fetchImpl = backendWith(issueCost().totalSatoshis - 1);
    });
    When('I issue a licence to a valid key in cairn', async () => {
      await capture(
        issueLicence({ holderPublicKeyHex: HOLDER_PUBLIC_KEY, collection: 'cairn', issuerKey: ISSUER_MASTER, fetchImpl: asFetch(), provider: new FakeChainProvider() }),
      );
    });
    Then('it is refused for not enough sats', () => {
      expect(outcome.error?.code).toBe('insufficient-funds');
      expect(outcome.error?.message).toMatch(/not enough sats/i);
    });
    And('nothing is broadcast', () => {
      expect(broadcasts(fetchImpl)).toHaveLength(0);
    });
  });

  Scenario('AC5: revoking writes a revoke record naming the origin from my key', ({ Given, When, Then, And }) => {
    const origin = `${'c'.repeat(64)}:0`;
    Given('I hold enough sats to issue a licence', () => {
      fetchImpl = backendWith(10_000);
    });
    When('I revoke the licence at a given origin', async () => {
      await capture(revokeLicence({ origin, issuerKey: ISSUER_MASTER, fetchImpl: asFetch() }));
    });
    Then('one transaction is broadcast through the backend', () => {
      expect(outcome.error).toBeUndefined();
      expect(broadcasts(fetchImpl)).toHaveLength(1);
    });
    And('it carries a revoke record naming that origin', () => {
      const [tx] = broadcasts(fetchImpl);
      const record = decodeTypedRecordScript(tx.outputs[0].lockingScript);
      expect(record?.recordType).toBe('W');
      expect(JSON.parse(Utils.toUTF8(record!.payloadBytes))).toEqual({ kind: 'revoke', origin });
    });
    And('it is signed by my key', () => {
      const [tx] = broadcasts(fetchImpl);
      const pushed = tx.inputs[0].unlockingScript!.chunks.map((chunk) => Utils.toHex(chunk.data ?? []));
      expect(pushed).toContain(ISSUER_PUBLIC_KEY);
    });
  });

  Scenario("AC6: the licences I issued are listed, revoked ones marked, and others' mints left out", ({ Given, When, Then, And }) => {
    const provider = new FakeChainProvider();
    let firstTxid = '';
    let secondTxid = '';
    let listed: IssuedLicenceEntry[] = [];

    Given('the chain holds a mint I signed, a revoke of it I signed, a second mint I signed, and a mint someone else signed', async () => {
      const add = (hex: string, height: number) => {
        const txid = Transaction.fromHex(hex).id('hex');
        provider.addTransaction(ISSUER_ADDRESS, txid, hex, height);
        return txid;
      };
      firstTxid = add(await signedRecordTxHex(ISSUER, 'M', { collection: 'cairn', holder: HOLDER_ADDRESS }, 0), 100);
      add(await signedRecordTxHex(ISSUER, 'W', { kind: 'revoke', origin: `${firstTxid}:0` }, 1), 110);
      secondTxid = add(await signedRecordTxHex(ISSUER, 'M', { collection: 'ledger', holder: HOLDER_ADDRESS }, 2), 120);
      add(await signedRecordTxHex(OTHER, 'M', { collection: 'cairn', holder: ISSUER_ADDRESS }, 3), 130);
    });
    When('I list the licences I issued', async () => {
      listed = await issuedLicences({ issuerPublicKeyHex: ISSUER_PUBLIC_KEY, provider });
    });
    Then('I see two licences, the newest first', () => {
      expect(listed.map((l) => l.txid)).toEqual([secondTxid, firstTxid]);
    });
    And('the first mint is marked revoked', () => {
      expect(listed.find((l) => l.txid === firstTxid)?.revoked).toBe(true);
    });
    And('the second is not', () => {
      expect(listed.find((l) => l.txid === secondTxid)?.revoked).toBe(false);
    });
  });
});
