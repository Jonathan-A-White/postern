// tests/support/stamp-fetch.ts — a faked WhatsOnChain for the stamp section (mw-zuju64.1): the raw hex of each
// stamp transaction and its tx info (`blocktime`, absent while the transaction is in the mempool).
import { chainConfig } from 'spell-forge-bsv';
import type { ChainRecord } from './chain-record';

export interface StampFetch {
  fetchImpl: typeof fetch;
  /** Every URL asked of WhatsOnChain, in order. */
  calls: string[];
  /** Makes every answer a network failure. */
  down: boolean;
  /** The unix seconds the transaction was mined at; undefined for the mempool. */
  blockTime?: number;
}

function reply(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
}

export function stampFetch(txs: ChainRecord[], blockTime?: number): StampFetch {
  const fake: StampFetch = { calls: [], down: false, blockTime, fetchImpl: undefined as unknown as typeof fetch };
  fake.fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fake.calls.push(url);
    if (fake.down) throw new TypeError('Failed to fetch');
    const raw = new RegExp(`^${chainConfig.providerBaseUrl}/tx/([0-9a-f]{64})/hex$`).exec(url);
    if (raw) {
      const found = txs.find((tx) => tx.txid === raw[1]);
      return found ? reply(200, found.hex) : reply(404, 'not found');
    }
    const info = new RegExp(`^${chainConfig.providerBaseUrl}/tx/hash/([0-9a-f]{64})$`).exec(url);
    if (info) return reply(200, fake.blockTime === undefined ? { txid: info[1], confirmations: 0 } : { txid: info[1], blocktime: fake.blockTime, confirmations: 3 });
    return reply(404, 'not found');
  }) as typeof fetch;
  return fake;
}
