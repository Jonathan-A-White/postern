// tests/support/fake-woc.ts — a phone whose backend cannot be reached (every /api call is a
// network failure) beside a faked WhatsOnChain that lists one coin and takes a broadcast
// (docs/protocol.md §21). `apiCalls` and `wocCalls` say which side was asked.
import { Transaction } from '@bsv/sdk';
import { chainConfig } from 'spell-forge-bsv';

export interface BackendDownWoc {
  fetchImpl: typeof fetch;
  /** Every URL asked of the backend (all of which failed). */
  apiCalls: string[];
  /** Every URL asked of WhatsOnChain. */
  wocCalls: string[];
  /** The raw transactions broadcast to WhatsOnChain. */
  broadcasts: string[];
}

export function backendDownWoc(coinSatoshis = 10_000): BackendDownWoc {
  const fake: BackendDownWoc = { apiCalls: [], wocCalls: [], broadcasts: [], fetchImpl: undefined as unknown as typeof fetch };
  fake.fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(chainConfig.providerBaseUrl)) {
      fake.apiCalls.push(url);
      throw new TypeError('Failed to fetch');
    }
    fake.wocCalls.push(url);
    if (url.endsWith('/unspent')) {
      return new Response(JSON.stringify([{ tx_hash: 'a'.repeat(64), tx_pos: 0, value: coinSatoshis, height: 100 }]), { status: 200 });
    }
    if (url.endsWith('/tx/raw')) {
      const { txhex } = JSON.parse(String(init?.body)) as { txhex: string };
      fake.broadcasts.push(txhex);
      return new Response(JSON.stringify(Transaction.fromHex(txhex).id('hex')), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return fake;
}
