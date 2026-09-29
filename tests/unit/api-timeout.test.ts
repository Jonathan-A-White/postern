// mw-t64a3.7: every /api call times out, and the error says whether the request
// itself had gone out (a POST after its challenge) or nothing had.
import { PrivateKey } from '@bsv/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiTimeoutError, API_TIMEOUT_MS, apiFetch } from '../../src/services/apiAuth';
import { uploadAttachment } from '../../src/services/attachments';
import { describeSendError, MAY_HAVE_GONE, NOT_SENT } from '../../src/cockpit/send';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';

const KEY = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1));
const MAYOR = PrivateKey.fromRandom().toPublicKey().toString();
const hangs = () => new Promise<Response>(() => {});

async function failureOf(work: Promise<unknown>): Promise<unknown> {
  const caught = work.then(
    () => undefined,
    (err: unknown) => err,
  );
  await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
  return caught;
}

describe('apiFetch timeouts', () => {
  afterEach(() => vi.useRealTimers());

  it('a challenge that never answers is a timeout before anything was sent', async () => {
    vi.useFakeTimers();
    const err = await failureOf(apiFetch('/messages', { method: 'POST' }, { unlockedKey: KEY, fetchImpl: hangs as unknown as typeof fetch }));
    expect(err).toBeInstanceOf(ApiTimeoutError);
    expect((err as ApiTimeoutError).sent).toBe(false);
    expect(describeSendError(err)).toBe(NOT_SENT);
  });

  it('a POST that never answers is a timeout after it was sent', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => (isChallengeRequest(String(url)) ? challengeResponse() : hangs()));
    const err = await failureOf(apiFetch('/messages', { method: 'POST' }, { unlockedKey: KEY, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect((err as ApiTimeoutError).sent).toBe(true);
    expect(describeSendError(err)).toBe(MAY_HAVE_GONE);
  });

  it('a GET that never answers has not sent anything', async () => {
    vi.useFakeTimers();
    const err = await failureOf(apiFetch('/view', undefined, { fetchImpl: hangs as unknown as typeof fetch }));
    expect((err as ApiTimeoutError).sent).toBe(false);
  });

  it('aborts the fetch it gave up on, and still honours the caller\'s own signal', async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return hangs();
    });
    await failureOf(apiFetch('/view', undefined, { fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(seen?.aborted).toBe(true);

    const caller = new AbortController();
    void apiFetch('/events', { signal: caller.signal }, { fetchImpl: fetchImpl as unknown as typeof fetch }).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    caller.abort();
    expect(seen?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
  });

  it('a blob upload that times out is reported as not sent, though it is a POST', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => (isChallengeRequest(String(url)) ? challengeResponse() : hangs()));
    const err = await failureOf(
      uploadAttachment({ bytes: new Uint8Array([1, 2, 3]), mime: 'image/png', senderKey: KEY, recipientPublicKeyHex: MAYOR, fetchImpl: fetchImpl as unknown as typeof fetch }),
    );
    expect(describeSendError(err)).toBe(NOT_SENT);
  });
});
