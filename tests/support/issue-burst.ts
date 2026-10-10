// tests/support/issue-burst.ts — the world of mw-i7cwnn: the backend and a WhatsOnChain that refuses what
// the free tier refuses (two requests under 350 ms apart, or more than 3 in a second), answering one fetch.
// The 429 carries no CORS header, so the phone sees a failed fetch. Used by tests/unit/issue-burst.test.tsx
// and features/steps/issue-burst.steps.tsx; each registers the vi.mock of the mint builder (mint-builder-mock.ts) itself.
import { PrivateKey, Transaction } from '@bsv/sdk';
import { vi } from 'vitest';
import { challengeResponse, isChallengeRequest } from './challenge-fetch';
import { signedRecordTxHex } from './nftgate-fixtures';
import { wocStub, type WocStub } from './woc-stub';

export const ISSUER = PrivateKey.fromHex('11'.repeat(32));
export const ISSUER_MASTER = new Uint8Array(ISSUER.toArray('be', 32));
export const COIN_TXID = 'a'.repeat(64);
export const HOLDERS = ['22', '33', '44'].map((byte) => PrivateKey.fromHex(byte.repeat(32)).toPublicKey().toString());

/** Stubs fetch for both; `hexRefusedFor` may make a new transaction's hex fail for a while. */
export async function serveBackendAndWhatsOnChain(options: { hexRefusedFor?: (txid: string, woc: WocStub) => void } = {}) {
  const hexByTxid: Record<string, string> = { [COIN_TXID]: await signedRecordTxHex(ISSUER, 'M', { collection: 'x', holder: 'y' }, 0) };
  const unconfirmed: Array<{ tx_hash: string; height: number }> = [];
  const woc = wocStub({
    pages: [[]],
    unconfirmed,
    hexByTxid,
    rateLimit: { gapMs: 350, perWindow: 3, windowMs: 1000 },
  });
  const broadcast: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/v1/bsv/')) return (woc.fetchImpl as unknown as typeof fetch)(input);
      if (isChallengeRequest(url)) return challengeResponse();
      if (url.endsWith('/me')) {
        const me = { pubkey: ISSUER.toPublicKey().toString(), mayor: '', network: 'testnet', features: ['me'], collections: [{ name: 'postern' }] };
        return new Response(JSON.stringify(me), { status: 200 });
      }
      if (url.includes('/utxos/')) {
        return new Response(JSON.stringify({ utxos: [{ txid: COIN_TXID, vout: 0, satoshis: 900_000, height: 100 }] }), { status: 200 });
      }
      if (url.endsWith('/broadcast')) {
        const hex = (JSON.parse(String(init?.body)) as { rawtx: string }).rawtx;
        const txid = Transaction.fromHex(hex).id('hex');
        broadcast.push(txid);
        if (options.hexRefusedFor) options.hexRefusedFor(txid, woc);
        hexByTxid[txid] = hex; // WhatsOnChain serves a mempool transaction's hex at once
        unconfirmed.push({ tx_hash: txid, height: 0 });
        return new Response(JSON.stringify({ txid }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );

  return { broadcast, woc };
}

