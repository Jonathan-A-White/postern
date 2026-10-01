// When a Call me goes on chain and when it does not (docs/protocol.md §21).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivateKey, Transaction, Utils } from '@bsv/sdk';
import { deliver, settledWrites } from '../../src/services/deliver';
import { db } from '../../src/data/db';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';
import { backendDownWoc } from '../support/fake-woc';

const KEY = new Uint8Array(Utils.toArray('45'.repeat(32), 'hex'));
const MAYOR = PrivateKey.fromHex('77'.repeat(32)).toPublicKey().toString();
const base = { key: KEY, mayorKey: MAYOR, direct: true };

afterEach(async () => {
  await settledWrites();
  await db.pendingSpends.clear();
  await db.messages.clear();
});

describe('a gateway error from the backend', () => {
  it('sends a Call me on chain, and still fails a refusal with the backend\'s own words', async () => {
    const down = backendDownWoc();
    let refuse = false;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (isChallengeRequest(url)) return challengeResponse();
      if (url.endsWith('/messages')) return new Response(JSON.stringify({ error: 'bad gateway' }), { status: refuse ? 400 : 502 });
      return down.fetchImpl(input, init);
    }) as unknown as typeof fetch;

    const call = await deliver('{"role":"request","text":"Call me","at":1}', 'call', { ...base, fetchImpl });
    expect(call.channel).toBe('chain');
    expect(down.broadcasts).toHaveLength(1);

    refuse = true;
    await expect(deliver('hello', 'message', { ...base, fetchImpl })).rejects.toThrow('bad gateway');
    expect(down.broadcasts).toHaveLength(1);
  });
});

describe('a backend without direct delivery', () => {
  it('still funds a Call me through the backend, not WhatsOnChain', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      if (isChallengeRequest(url)) return challengeResponse();
      if (url.endsWith('/messages')) return new Response('', { status: 404 });
      if (url.includes('/utxos/')) return new Response(JSON.stringify({ utxos: [{ txid: 'a'.repeat(64), vout: 0, satoshis: 10_000 }] }), { status: 200 });
      if (url.endsWith('/broadcast')) {
        const { rawtx } = JSON.parse(String(init?.body)) as { rawtx: string };
        return new Response(JSON.stringify({ txid: Transaction.fromHex(rawtx).id('hex') }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const call = await deliver('{"role":"request","text":"Call me","at":1}', 'call', { ...base, fetchImpl });
    expect(call.channel).toBe('chain');
    expect(urls.some((url) => url.includes('whatsonchain'))).toBe(false);
  });
});
