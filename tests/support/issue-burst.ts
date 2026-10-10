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
export interface BackendRefusal {
  status: number;
  error: string;
}

/** WhatsOnChain's own 429 page, as the backend relays it in its 502 (writeProviderError): the words the Governor saw (mw-rch8bu). */
export const WOC_429_PAGE = '<html> <head> <title>429 Too Many Requests</title> </head> <body> <center><h1>429 Too Many Requests</h1></center> <hr><center>nginx/1.18.0 (Ubuntu)</center> </body> </html>';
export const WOC_429_ERROR: BackendRefusal = { status: 502, error: `WhatsOnChain said 429: ${WOC_429_PAGE}` };

/**
 * Stubs fetch for both; `hexRefusedFor` may make a new transaction's hex fail for a while, and `backendRefuses`
 * may make the backend's /utxos or /broadcast answer a refusal (its `call` counts from 1) instead of working.
 */
export async function serveBackendAndWhatsOnChain(
  options: {
    hexRefusedFor?: (txid: string, woc: WocStub) => void;
    backendRefuses?: (route: 'utxos' | 'broadcast', call: number) => BackendRefusal | undefined;
    /** The issuer already holds one mint (COIN_TXID, collection x), so the Issued licences list has a row to Revoke. */
    issuedMint?: boolean;
    /** False: WhatsOnChain's own reads are not rate-limited, for a test about the backend's 429 only (default true). */
    wocRateLimit?: boolean;
  } = {},
) {
  const hexByTxid: Record<string, string> = { [COIN_TXID]: await signedRecordTxHex(ISSUER, 'M', { collection: 'x', holder: 'y' }, 0) };
  const unconfirmed: Array<{ tx_hash: string; height: number }> = [];
  const woc = wocStub({
    pages: [options.issuedMint ? [{ tx_hash: COIN_TXID, height: 100 }] : []],
    unconfirmed,
    hexByTxid,
    rateLimit: options.wocRateLimit === false ? undefined : { gapMs: 350, perWindow: 3, windowMs: 1000 },
  });
  const broadcast: string[] = [];
  const calls = { utxos: 0, broadcast: 0 };
  const refusal = (route: 'utxos' | 'broadcast') => {
    calls[route]++;
    const refused = options.backendRefuses?.(route, calls[route]);
    return refused ? new Response(JSON.stringify({ error: refused.error }), { status: refused.status }) : undefined;
  };
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
        const refused = refusal('utxos');
        if (refused) return refused;
        return new Response(JSON.stringify({ utxos: [{ txid: COIN_TXID, vout: 0, satoshis: 900_000, height: 100 }] }), { status: 200 });
      }
      if (url.endsWith('/broadcast')) {
        const refused = refusal('broadcast');
        if (refused) return refused;
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

  return { broadcast, woc, calls };
}

