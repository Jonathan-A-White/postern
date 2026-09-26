import { describe, it, expect, vi } from 'vitest';
import { PrivateKey, PublicKey, Signature, Utils } from '@bsv/sdk';
import { apiFetch } from '../../src/services/apiAuth';

const KEY = PrivateKey.fromRandom();
const MASTER_KEY = new Uint8Array(Utils.toArray(KEY.toHex(), 'hex'));
const NONCE = 'a'.repeat(64);

function challengeResponse(): Response {
  return new Response(JSON.stringify({ nonce: NONCE }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiFetch', () => {
  it('fetches a challenge and attaches a header the backend can verify, when a key is given', async () => {
    let capturedAuth: string | null = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/challenge')) return challengeResponse();
      if (url.endsWith('/messages?since=0')) {
        capturedAuth = new Headers(init?.headers).get('Authorization');
        return new Response(JSON.stringify({ records: [], next: 0 }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await apiFetch('/messages?since=0', undefined, { unlockedKey: MASTER_KEY, fetchImpl });

    expect(capturedAuth).not.toBeNull();
    const match = capturedAuth!.match(/^Postern ([0-9a-f]+):([0-9a-f]+):([0-9a-f]+)$/);
    expect(match).not.toBeNull();
    const [, pubkeyHex, nonceHex, sigHex] = match!;
    expect(pubkeyHex).toBe(KEY.toPublicKey().toString());
    expect(nonceHex).toBe(NONCE);
    expect(PublicKey.fromString(pubkeyHex).verify(nonceHex, Signature.fromDER(sigHex, 'hex'))).toBe(true);
  });

  it('sends no Authorization header when no key is given', async () => {
    let sawAuth = false;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/challenge')) throw new Error('should not fetch a challenge with no key');
      sawAuth = new Headers(init?.headers).has('Authorization');
      return new Response(JSON.stringify({ records: [], next: 0 }), { status: 200 });
    });

    await apiFetch('/messages?since=0', undefined, { fetchImpl });

    expect(sawAuth).toBe(false);
  });

  it('turns a 401 into a plain "Licence required" error, whether or not a key was given', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/challenge')) return challengeResponse();
      return new Response(JSON.stringify({ error: 'no licence held' }), { status: 401 });
    });

    await expect(apiFetch('/messages?since=0', undefined, { fetchImpl })).rejects.toThrow('Licence required');
    await expect(apiFetch('/messages?since=0', undefined, { unlockedKey: MASTER_KEY, fetchImpl })).rejects.toThrow(
      'Licence required',
    );
  });

  it('returns the response unchanged for a non-401 status', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 502 }));
    const response = await apiFetch('/messages?since=0', undefined, { fetchImpl });
    expect(response.status).toBe(502);
  });

  it('signs a fresh nonce for every authenticated call', async () => {
    let challengeCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/challenge')) {
        challengeCalls += 1;
        return challengeResponse();
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await apiFetch('/a', undefined, { unlockedKey: MASTER_KEY, fetchImpl });
    await apiFetch('/b', undefined, { unlockedKey: MASTER_KEY, fetchImpl });

    expect(challengeCalls).toBe(2);
  });
});
