// src/services/billing.ts (mw-cvwm1u.22): the Governor's 'API only' switch on a licence holder, over
// GET and PUT /api/register/billing. Only the Governor's key is asked; the backend decides.
import { describe, expect, it } from 'vitest';
import { PrivateKey } from '@bsv/sdk';
import { readApiOnly, setApiOnly } from '../../src/services/billing';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';

const MASTER = new Uint8Array(PrivateKey.fromHex('11'.repeat(32)).toArray('be', 32));
/** A holder as the Key screen lists it: a testnet address. */
const HOLDER = PrivateKey.fromHex('22'.repeat(32)).toPublicKey().toAddress('testnet');
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function backend(answer: (method: string, url: string, body: string) => Response) {
  const calls: { method: string; url: string; body: string }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (isChallengeRequest(url)) return challengeResponse();
    const call = { method: init?.method ?? 'GET', url, body: String(init?.body ?? '') };
    calls.push(call);
    return answer(call.method, url, call.body);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('the billing service', () => {
  it('reads the holders billed API only', async () => {
    const { calls, fetchImpl } = backend(() => json(200, { api: [HOLDER, 'mnotherholder'] }));
    const keys = await readApiOnly(MASTER, { apiBase: 'https://b.test/api', fetchImpl });
    expect(keys).toEqual(new Set([HOLDER, 'mnotherholder']));
    expect(calls).toEqual([{ method: 'GET', url: 'https://b.test/api/register/billing', body: '' }]);
  });

  it('sets a holder API only, and back to Max', async () => {
    const { calls, fetchImpl } = backend((_m, _u, body) => json(200, JSON.parse(body)));
    await setApiOnly(MASTER, HOLDER, true, { apiBase: 'https://b.test/api', fetchImpl });
    await setApiOnly(MASTER, HOLDER, false, { apiBase: 'https://b.test/api', fetchImpl });
    expect(calls.map((c) => [c.method, c.url, JSON.parse(c.body)])).toEqual([
      ['PUT', 'https://b.test/api/register/billing', { holder: HOLDER, billing: 'api' }],
      ['PUT', 'https://b.test/api/register/billing', { holder: HOLDER, billing: 'max' }],
    ]);
  });

  it('says in the backend\'s words why it was refused', async () => {
    const { fetchImpl } = backend(() => json(403, { error: 'only the Governor\'s key may mark a licence holder\'s billing' }));
    await expect(setApiOnly(MASTER, HOLDER, true, { apiBase: 'https://b.test/api', fetchImpl })).rejects.toThrow("only the Governor's key may mark a licence holder's billing");
    await expect(readApiOnly(MASTER, { apiBase: 'https://b.test/api', fetchImpl })).rejects.toThrow("only the Governor's key");
  });

  it('says an older backend needs updating', async () => {
    const { fetchImpl } = backend(() => json(404, {}));
    await expect(readApiOnly(MASTER, { apiBase: 'https://b.test/api', fetchImpl })).rejects.toThrow('need a newer backend');
  });

  it('refuses an answer that is not the list', async () => {
    const { fetchImpl } = backend(() => json(200, { nope: 1 }));
    await expect(readApiOnly(MASTER, { apiBase: 'https://b.test/api', fetchImpl })).rejects.toThrow('not the billing marks');
  });
});
