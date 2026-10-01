// The two WhatsOnChain adapters Call me uses when the backend cannot be reached
// (docs/protocol.md §21): the address's unspent coins, and a raw transaction's broadcast.
import { describe, expect, it, vi } from 'vitest';
import { chainConfig } from 'spell-forge-bsv';
import { broadcastThroughWhatsOnChain, fetchUtxosFromWhatsOnChain } from '../../src/services/whatsonchain';

const ADDRESS = 'mt6vaAWeFxu2qC6pPs7bsqTNvv87dCwMW5';
const TXID = 'b'.repeat(64);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('fetchUtxosFromWhatsOnChain', () => {
  it('reads the address\'s unspent list from the chain provider and maps it to coins', async () => {
    const asked: string[] = [];
    const fetchImpl = vi.fn(async (url: string) =>
      (asked.push(url), json([
        { tx_hash: 'a'.repeat(64), tx_pos: 1, value: 5000, height: 120 },
        { tx_hash: 'c'.repeat(64), tx_pos: 0, value: 700, height: 0 },
      ])),
    );
    const utxos = await fetchUtxosFromWhatsOnChain(ADDRESS, fetchImpl as unknown as typeof fetch);
    expect(asked[0]).toBe(`${chainConfig.providerBaseUrl}/address/${ADDRESS}/unspent`);
    expect(utxos).toEqual([
      { txid: 'a'.repeat(64), vout: 1, satoshis: 5000, height: 120 },
      { txid: 'c'.repeat(64), vout: 0, satoshis: 700, height: 0 },
    ]);
  });

  it('reads an address the chain has never seen (404) as having no coins', async () => {
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 }));
    expect(await fetchUtxosFromWhatsOnChain(ADDRESS, fetchImpl as unknown as typeof fetch)).toEqual([]);
  });

  it('says plainly when the provider fails or answers something that is not a list', async () => {
    const down = vi.fn(async () => new Response('busy', { status: 503 }));
    await expect(fetchUtxosFromWhatsOnChain(ADDRESS, down as unknown as typeof fetch)).rejects.toThrow(/WhatsOnChain/);
    const odd = vi.fn(async () => json({ nope: true }));
    await expect(fetchUtxosFromWhatsOnChain(ADDRESS, odd as unknown as typeof fetch)).rejects.toThrow(/WhatsOnChain/);
  });
});

describe('broadcastThroughWhatsOnChain', () => {
  it('posts {txhex} to /tx/raw and resolves the txid it answers', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(TXID), { status: 200 }));
    const txid = await broadcastThroughWhatsOnChain('0100aa', fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${chainConfig.providerBaseUrl}/tx/raw`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ txhex: '0100aa' });
    expect(txid).toBe(TXID);
  });

  it('accepts the txid bare, without quotes', async () => {
    const fetchImpl = vi.fn(async () => new Response(`${TXID}\n`, { status: 200 }));
    expect(await broadcastThroughWhatsOnChain('00', fetchImpl as unknown as typeof fetch)).toBe(TXID);
  });

  it('throws the provider\'s refusal, and an answer that is no txid', async () => {
    const refused = vi.fn(async () => new Response('258: txn-mempool-conflict', { status: 400 }));
    await expect(broadcastThroughWhatsOnChain('00', refused as unknown as typeof fetch)).rejects.toThrow(/txn-mempool-conflict/);
    const odd = vi.fn(async () => new Response('"ok"', { status: 200 }));
    await expect(broadcastThroughWhatsOnChain('00', odd as unknown as typeof fetch)).rejects.toThrow(/transaction id/);
  });
});
