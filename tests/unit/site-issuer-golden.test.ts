// The site issuer's golden fixture (mw-cvwm1u.3): the Go backend signs Lampas licences
// itself (server/internal/register/issue.go), and its Go test builds a mint and a revoke
// from server/internal/register/testdata/site-issuer-golden.json and compares them byte for
// byte with the ones recorded there. This keeps that fixture what the TS issuer writes today:
// the mint as spell-forge-bsv's buildContractMintTransaction builds it (run under Node by
// scripts/site-issuer-golden.mjs, since it cannot run under vitest), and the revoke as
// src/services/issue.ts's revokeLicence broadcasts it.
// UPDATE_SITE_ISSUER_GOLDEN=1 TZ=UTC npx vitest run tests/unit/site-issuer-golden.test.ts
// writes the fixture afresh instead of comparing.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrivateKey, Transaction } from '@bsv/sdk';
import { describe, expect, it } from 'vitest';
import { db } from '../../src/data/db';
import { addressForPublicKey } from '../../src/services/licence';
import { revokeLicence } from '../../src/services/issue';
import { ANCHOR_ADDRESS } from '../../src/services/messages';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';
import { FakeChainProvider } from '../support/fake-chain-provider';

const FIXTURE = join(process.cwd(), 'server/internal/register/testdata/site-issuer-golden.json');
const UPDATE = process.env.UPDATE_SITE_ISSUER_GOLDEN === '1';

interface Coin {
  txid: string;
  vout: number;
  satoshis: number;
}

interface Golden {
  issuerKeyHex: string;
  holderPublicKey: string;
  collection: string;
  mintFuelSatoshis: number;
  feeRateSatPerKb: number;
  funding: (Coin & { sourceHex: string })[];
  mint: { txid: string; hex: string };
  revoke: { anchor: string; origin: string; utxos: Coin[]; txid: string; hex: string };
}

/** The mint half, as spell-forge-bsv builds it today. */
function mintHalf(): Omit<Golden, 'revoke'> {
  const out = execFileSync(process.execPath, ['scripts/site-issuer-golden.mjs'], { encoding: 'utf8' });
  return JSON.parse(out) as Omit<Golden, 'revoke'>;
}

/** The revoke of that mint's licence, as revokeLicence broadcasts it, spending the mint's change. */
async function revokeHalf(mint: Omit<Golden, 'revoke'>): Promise<Golden['revoke']> {
  await db.pendingSpends.clear();
  const issuer = PrivateKey.fromHex(mint.issuerKeyHex);
  const issuerAddress = addressForPublicKey(issuer.toPublicKey().toString());
  const mintTx = Transaction.fromHex(mint.mint.hex);
  const origin = `${mint.mint.txid}:0`;
  const utxos: Coin[] = [
    { txid: mint.mint.txid, vout: 3, satoshis: mintTx.outputs[3].satoshis! },
    { txid: 'c'.repeat(64), vout: 1, satoshis: 1 },
    { txid: 'd'.repeat(64), vout: 2, satoshis: 500 },
  ];
  const provider = new FakeChainProvider();
  provider.addTransaction(issuerAddress, mint.mint.txid, mint.mint.hex, 100);
  let broadcast = '';
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (isChallengeRequest(url)) return challengeResponse();
    if (url.includes('/utxos/')) return new Response(JSON.stringify({ utxos: utxos.map((u) => ({ ...u, height: 100 })) }), { status: 200 });
    if (url.endsWith('/broadcast')) {
      broadcast = (JSON.parse(String(init?.body)) as { rawtx: string }).rawtx;
      return new Response(JSON.stringify({ txid: Transaction.fromHex(broadcast).id('hex') }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  const { txid } = await revokeLicence({
    origin,
    issuerKey: new Uint8Array(issuer.toArray('be', 32)),
    fetchImpl: fetchImpl as typeof fetch,
    provider,
  });
  return { anchor: ANCHOR_ADDRESS, origin, utxos, txid, hex: broadcast };
}

describe('the site issuer golden fixture (mw-cvwm1u.3)', () => {
  it('builds from the very contract artifacts spell-forge-bsv ships', () => {
    for (const name of ['license.json', 'fuel.json']) {
      const shipped = readFileSync(join(process.cwd(), 'node_modules/spell-forge-bsv/dist/contracts/artifacts', name), 'utf8');
      const copied = readFileSync(join(process.cwd(), 'server/internal/register/contracts', name), 'utf8');
      expect(copied, `server/internal/register/contracts/${name}`).toBe(shipped);
    }
  });

  it('is the mint and the revoke the TS issuer writes today', async () => {
    const mint = mintHalf();
    const golden: Golden = { ...mint, revoke: await revokeHalf(mint) };
    if (UPDATE) {
      writeFileSync(FIXTURE, JSON.stringify(golden, null, 2) + '\n');
    }
    expect(existsSync(FIXTURE)).toBe(true);
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(golden);
  });
});
