// tests/unit/outbox-client-id.test.ts — mw-jrx0s.23: every outbox row carries a client id, made once, and
// every direct post carries it. The retry-after-a-lost-reply behaviour is features/outbox-client-id.feature.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivateKey, Utils } from '@bsv/sdk';
import { db } from '../../src/data/db';
import { newClientId, outboxRepo } from '../../src/data/repositories';
import { deliver, settledWrites } from '../../src/services/deliver';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';

const KEY = new Uint8Array(Utils.toArray('45'.repeat(32), 'hex'));
const MAYOR = PrivateKey.fromHex('77'.repeat(32)).toPublicKey().toString();

afterEach(async () => {
  await settledWrites();
  await db.messages.clear();
  await db.outbox.clear();
});

describe('client ids', () => {
  it('are 128 random bits as hex, and differ', () => {
    const [a, b] = [newClientId(), newClientId()];
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it('are given to a row once, when it is written, and stay in the Dexie row', async () => {
    const id = await outboxRepo.add({ kind: 'action', bead: 'mw-a', payload: {} });
    const written = (await db.outbox.get(id))?.clientId;
    expect(written).toMatch(/^[0-9a-f]{32}$/);
    await outboxRepo.update(id, { attempts: 3 });
    expect((await db.outbox.get(id))?.clientId).toBe(written);
  });
});

describe('a direct post', () => {
  function post(clientId?: string): Promise<unknown> {
    let body: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (isChallengeRequest(String(input))) return challengeResponse();
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ txid: 'direct:1', seq: 1 }), { status: 201 });
    }) as unknown as typeof fetch;
    return deliver('hi', 'message', { key: KEY, mayorKey: MAYOR, direct: true, clientId, fetchImpl }).then(() => body);
  }

  it('names the row\'s client id beside the script', async () => {
    expect(await post('ab'.repeat(16))).toMatchObject({ scriptHex: expect.any(String), clientId: 'ab'.repeat(16) });
  });

  it('carries none when it has none (a send that is not an outbox row)', async () => {
    expect(await post()).not.toHaveProperty('clientId');
  });
});
