// tests/unit/outbox-refusal.test.ts — mw-jrx0s.21: which refusals are final. A 4xx the backend gives
// (other than 408 and 429) is a permanent refusal that carries its status and the backend's words; a
// timeout, a gateway error, a 5xx, a 408 and a 429 are transient and keep their place in the queue.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivateKey, Utils } from '@bsv/sdk';
import { ApiTimeoutError, BackendUnreachableError, RefusedError, isPermanentRefusal } from '../../src/services/apiAuth';
import { deliver, settledWrites } from '../../src/services/deliver';
import { uploadAttachment } from '../../src/services/attachments';
import { db } from '../../src/data/db';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';

const KEY = new Uint8Array(Utils.toArray('45'.repeat(32), 'hex'));
const MAYOR = PrivateKey.fromHex('77'.repeat(32)).toPublicKey().toString();
const base = { key: KEY, mayorKey: MAYOR, direct: true };

afterEach(async () => {
  await settledWrites();
  await db.messages.clear();
});

function backendAnswering(path: string, status: number, error: string): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (isChallengeRequest(url)) return challengeResponse();
    if (url.endsWith(path)) return new Response(JSON.stringify({ error }), { status });
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

describe('isPermanentRefusal', () => {
  it('is a 4xx, except a request timeout and too many requests', () => {
    for (const status of [400, 401, 403, 413, 422]) expect(isPermanentRefusal(new RefusedError('no', status))).toBe(true);
    for (const status of [408, 429, 500, 503]) expect(isPermanentRefusal(new RefusedError('no', status))).toBe(false);
  });

  it('is never a lost connection, a timeout, a gateway error or a plain error', () => {
    expect(isPermanentRefusal(new TypeError('Failed to fetch'))).toBe(false);
    expect(isPermanentRefusal(new ApiTimeoutError(true))).toBe(false);
    expect(isPermanentRefusal(new BackendUnreachableError('bad gateway'))).toBe(false);
    expect(isPermanentRefusal(new Error('boom'))).toBe(false);
  });
});

describe('what a direct delivery throws', () => {
  it('a 400 is a refusal with its status and the backend\'s own words', async () => {
    const err = await deliver('hello', 'message', { ...base, fetchImpl: backendAnswering('/messages', 400, 'unknown class') }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RefusedError);
    expect(err).toMatchObject({ status: 400, message: 'unknown class' });
    expect(isPermanentRefusal(err)).toBe(true);
  });

  it('a 413 on an upload is a refusal too', async () => {
    const err = await uploadAttachment({ bytes: new Uint8Array([1, 2, 3]), mime: 'image/png', senderKey: KEY, recipientPublicKeyHex: MAYOR, fetchImpl: backendAnswering('/blobs', 413, 'too big') }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 413, message: 'too big' });
    expect(isPermanentRefusal(err)).toBe(true);
  });

  it('a 503 and a 500 are not final, and a 429 is not final', async () => {
    expect(isPermanentRefusal(await deliver('hello', 'message', { ...base, fetchImpl: backendAnswering('/messages', 503, 'down') }).catch((e: unknown) => e))).toBe(false);
    expect(isPermanentRefusal(await deliver('hello', 'message', { ...base, fetchImpl: backendAnswering('/messages', 500, 'oops') }).catch((e: unknown) => e))).toBe(false);
    expect(isPermanentRefusal(await deliver('hello', 'message', { ...base, fetchImpl: backendAnswering('/messages', 429, 'slow down') }).catch((e: unknown) => e))).toBe(false);
  });
});
