// A typed post goes on chain when the backend is down; a picture waits (docs/protocol.md §21).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivateKey, Utils } from '@bsv/sdk';
import { deliver, deliverThreaded, settledWrites } from '../../src/services/deliver';
import { db, type MessageRow, type OutboxRow } from '../../src/data/db';
import { itemFromMessage } from '../../src/model/conversation';
import { pendingMessageItems } from '../../src/model/outbox';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';
import { backendDownWoc } from '../support/fake-woc';

const KEY = new Uint8Array(Utils.toArray('45'.repeat(32), 'hex'));
const MAYOR = PrivateKey.fromHex('77'.repeat(32)).toPublicKey().toString();
const base = { key: KEY, mayorKey: MAYOR, direct: true };
const PICTURE = { id: 'a'.repeat(64), name: 'shot.png', mime: 'image/png', size: 10, key: 'b'.repeat(64) } as never;

afterEach(async () => {
  await settledWrites();
  await db.pendingSpends.clear();
  await db.messages.clear();
});

describe('a typed post while the backend is down', () => {
  it('goes on chain at once when the phone knows it is offline, and its row reads Sent on chain', async () => {
    const down = backendDownWoc();
    const delivered = await deliver('hello', 'message', { ...base, offline: true, fetchImpl: down.fetchImpl });
    expect(delivered.channel).toBe('chain');
    expect(down.broadcasts).toHaveLength(1);
    expect(down.apiCalls).toEqual([]);
    await settledWrites();
    const row = (await db.messages.get(`${delivered.txid}:0`)) as MessageRow;
    expect(row.direction).toBe('sent');
    expect(itemFromMessage(row).onChain).toBe(true);
  });

  it('goes on chain when its direct post fails on a network error', async () => {
    const down = backendDownWoc();
    const delivered = await deliver('hello', 'message', { ...base, fetchImpl: down.fetchImpl });
    expect(delivered.channel).toBe('chain');
    expect(down.broadcasts).toHaveLength(1);
  });

  it('goes on chain after a gateway error, but a refusal in the backend\'s own words still fails', async () => {
    const down = backendDownWoc();
    let status = 502;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (isChallengeRequest(url)) return challengeResponse();
      if (url.endsWith('/messages')) return new Response(JSON.stringify({ error: 'bad gateway' }), { status });
      return down.fetchImpl(input, init);
    }) as unknown as typeof fetch;
    expect((await deliver('hello', 'message', { ...base, fetchImpl })).channel).toBe('chain');
    status = 400;
    await expect(deliver('hello again', 'message', { ...base, fetchImpl })).rejects.toThrow('bad gateway');
    expect(down.broadcasts).toHaveLength(1);
  });

  it('is not sent on chain when it carries a picture, offline or not', async () => {
    const down = backendDownWoc();
    await expect(deliverThreaded({ text: 'look', attachments: [PICTURE] }, { ...base, offline: true, fetchImpl: down.fetchImpl })).rejects.toThrow();
    await expect(deliverThreaded({ text: 'look', attachments: [PICTURE] }, { ...base, fetchImpl: down.fetchImpl })).rejects.toBeInstanceOf(TypeError);
    expect(down.broadcasts).toEqual([]);
    expect(down.wocCalls).toEqual([]);
  });

  it('still goes on chain as a Call me did', async () => {
    const down = backendDownWoc();
    const delivered = await deliver('{"role":"request","text":"Call me","at":1}', 'call', { ...base, offline: true, fetchImpl: down.fetchImpl });
    expect(delivered.channel).toBe('chain');
    expect(down.broadcasts).toHaveLength(1);
  });
});

describe('the sent row', () => {
  it('reads Sent on chain for a post on a transaction, not for a direct one', () => {
    const row = (txid: string): MessageRow => ({ id: `${txid}:0`, txid, vout: 0, seq: 1, class: 'message', to: 'x', from: 'y', ts: 1, ciphertext: 'c', plaintext: 'hi', direction: 'sent', read: true });
    expect(itemFromMessage(row('c'.repeat(64))).onChain).toBe(true);
    expect(itemFromMessage(row(`direct:${'c'.repeat(64)}`)).onChain).toBeFalsy();
    expect(itemFromMessage({ ...row('c'.repeat(64)), direction: 'received' }).onChain).toBeFalsy();
  });

  it('is marked on chain too while its own record has not come back', () => {
    const outbox = (txid: string): OutboxRow => ({ id: 1, kind: 'message', bead: '', payload: { text: 'hi', files: [] }, state: 'sent', attempts: 1, created: 1, txid } as OutboxRow);
    expect(pendingMessageItems([outbox('d'.repeat(64))], [], () => true)[0].onChain).toBe(true);
    expect(pendingMessageItems([outbox(`direct:${'d'.repeat(64)}`)], [], () => true)[0].onChain).toBeFalsy();
  });
});
