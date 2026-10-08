import { describe, it, expect, vi } from 'vitest';
import { PrivateKey, Utils } from '@bsv/sdk';
import { apiFetch } from '../../src/services/apiAuth';
import { receivedRequest, v2Message, verifiesV2, type ReceivedRequest } from '../support/challenge-fetch';

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
    const match = capturedAuth!.match(/^Postern2 ([0-9a-f]+):([0-9a-f]+):([0-9a-f]+)$/);
    expect(match).not.toBeNull();
    const [, pubkeyHex, nonceHex] = match!;
    expect(pubkeyHex).toBe(KEY.toPublicKey().toString());
    expect(nonceHex).toBe(NONCE);
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

  describe('what a refusal says (mw-t64a3.25)', () => {
    const refusal = (reason: string | undefined) =>
      new Response(JSON.stringify({ error: 'refused', ...(reason ? { reason } : {}) }), { status: 401 });

    it('retries a nonce refusal once with a fresh challenge and succeeds', async () => {
      let challenges = 0;
      const auths: (string | null)[] = [];
      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/challenge')) {
          challenges += 1;
          return new Response(JSON.stringify({ nonce: String(challenges).repeat(64) }), { status: 200 });
        }
        auths.push(new Headers(init?.headers).get('Authorization'));
        return auths.length === 1 ? refusal('nonce') : new Response('{}', { status: 200 });
      });

      const response = await apiFetch('/blobs', { method: 'POST', body: 'x' }, { unlockedKey: MASTER_KEY, fetchImpl });

      expect(response.status).toBe(200);
      expect(challenges).toBe(2);
      expect(auths).toHaveLength(2);
      expect(auths[0]).not.toBe(auths[1]);
    });

    it('still says "Licence required" for a 401 that says no licence is held', async () => {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/challenge') ? challengeResponse() : refusal('no_licence'),
      );
      await expect(apiFetch('/me', undefined, { unlockedKey: MASTER_KEY, fetchImpl })).rejects.toThrow('Licence required');
    });

    it('does not retry a no-licence refusal', async () => {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/challenge') ? challengeResponse() : refusal('no_licence'),
      );
      await apiFetch('/me', undefined, { unlockedKey: MASTER_KEY, fetchImpl }).catch(() => undefined);
      expect(fetchImpl.mock.calls.filter(([u]) => String(u).endsWith('/challenge'))).toHaveLength(1);
    });

    it('retries a nonce refusal once only: a second one says what failed, without the word Licence', async () => {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/challenge') ? challengeResponse() : refusal('nonce'),
      );
      const failure = await apiFetch('/messages', { method: 'POST' }, { unlockedKey: MASTER_KEY, fetchImpl }).catch(
        (err: unknown) => err as Error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toContain('Licence');
      expect((failure as Error).message).not.toBe('');
      expect(fetchImpl.mock.calls.filter(([u]) => !String(u).endsWith('/challenge'))).toHaveLength(2);
    });

    it('says a rejected proof was rejected, not that a licence is needed', async () => {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/challenge') ? challengeResponse() : refusal('signature'),
      );
      const failure = await apiFetch('/me', undefined, { unlockedKey: MASTER_KEY, fetchImpl }).catch((err: unknown) => err as Error);
      expect((failure as Error).message).not.toContain('Licence');
    });

    it('falls back to "Licence required" for an old backend whose 401 names no reason', async () => {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/challenge') ? challengeResponse() : refusal(undefined),
      );
      await expect(apiFetch('/me', undefined, { unlockedKey: MASTER_KEY, fetchImpl })).rejects.toThrow('Licence required');
    });

    it('says the backend could not be reached when GET /api/challenge fails, not "Licence required"', async () => {
      const fetchImpl = vi.fn(async () => new Response('', { status: 503 }));
      const failure = await apiFetch('/me', undefined, { unlockedKey: MASTER_KEY, fetchImpl }).catch((err: unknown) => err as Error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toContain('Licence');
      expect((failure as Error).message).toContain('503');
    });
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

describe('apiAuth refuses to sign anything but a nonce (docs/protocol.md §17)', () => {
  it('never signs a "nonce" shaped like a hands approval, and sends nothing', async () => {
    const forged = `hands-approve/v1\n${'2d'.repeat(32)}\n1790000000\n`;
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return String(input).endsWith('/challenge')
        ? new Response(JSON.stringify({ nonce: forged }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : new Response('{}', { status: 200 });
    });
    await expect(apiFetch('/messages', undefined, { unlockedKey: new Uint8Array(32).fill(7), apiBase: '/api', fetchImpl })).rejects.toThrow('not a nonce');
    expect(calls).toEqual(['/api/challenge']);
  });
});

describe('apiFetch signs the whole request (Postern2, docs/api.md)', () => {
  const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  /** Runs one call against a stub that serves the challenge and records the signed request. */
  async function signedCall(path: string, init?: RequestInit): Promise<{ header: string | null; request: ReceivedRequest }> {
    let seen: { header: string | null; request: ReceivedRequest } | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, reqInit?: RequestInit) => {
      if (String(input).endsWith('/challenge')) return challengeResponse();
      seen = { header: new Headers(reqInit?.headers).get('Authorization'), request: receivedRequest(input, reqInit) };
      return new Response('{}', { status: 200 });
    });
    await apiFetch(path, init, { unlockedKey: MASTER_KEY, apiBase: '/api', fetchImpl: fetchImpl as unknown as typeof fetch });
    return seen!;
  }

  it('signs a POST with a JSON body over method, target, the body hash and the nonce', async () => {
    const body = JSON.stringify({ scriptHex: 'ab', note: 'é — ✓' });
    const { header, request } = await signedCall('/messages', { method: 'POST', body });

    expect(header?.startsWith('Postern2 ')).toBe(true);
    expect(request).toMatchObject({ method: 'POST', target: '/api/messages' });
    expect(await verifiesV2(header, request)).toBe(true);
    const digest = Utils.toHex(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)))));
    expect(await v2Message(request, NONCE)).toBe(`postern-v2\nPOST\n/api/messages\n${digest}\n${NONCE}`);
  });

  it('signs a POST with an ArrayBuffer body over the bytes as they are', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
    const { header, request } = await signedCall('/blobs', { method: 'POST', body: bytes.buffer.slice(0) });

    expect(request.body).toEqual(bytes);
    expect(await verifiesV2(header, request)).toBe(true);
  });

  it('signs a large ArrayBuffer body (hashed by crypto.subtle) the same way', async () => {
    const bytes = new Uint8Array(300 * 1024).map((_, i) => i % 251);
    const { header, request } = await signedCall('/blobs', { method: 'POST', body: bytes.buffer.slice(0) });

    expect(request.body).toHaveLength(bytes.length);
    expect(await verifiesV2(header, request)).toBe(true);
  });

  it('signs a GET with a query over the target exactly as sent, percent-encoding unchanged', async () => {
    const { header, request } = await signedCall('/blobs/%61bc?since=%30&q=a+b');

    expect(request).toMatchObject({ method: 'GET', target: '/api/blobs/%61bc?since=%30&q=a+b' });
    expect(await verifiesV2(header, request)).toBe(true);
  });

  it('signs a GET with no body over the sha256 of the empty string', async () => {
    const { header, request } = await signedCall('/events', { headers: { Accept: 'text/event-stream' } });

    expect(await v2Message(request, NONCE)).toBe(`postern-v2\nGET\n/api/events\n${EMPTY_SHA256}\n${NONCE}`);
    expect(await verifiesV2(header, request)).toBe(true);
  });

  it('upper-cases the method it signs', async () => {
    const { header, request } = await signedCall('/me', { method: 'post', body: '{}' });
    expect(request.method).toBe('POST');
    expect(await verifiesV2(header, request)).toBe(true);
  });

  it('refuses a body type it cannot hash, and sends nothing', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => (String(input).endsWith('/challenge') ? challengeResponse() : new Response('{}')));
    await expect(
      apiFetch('/blobs', { method: 'POST', body: new Blob(['x']) }, { unlockedKey: MASTER_KEY, apiBase: '/api', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/body/);
    expect(fetchImpl.mock.calls.filter(([u]) => !String(u).endsWith('/challenge'))).toHaveLength(0);
  });

  describe('the v2-verifying helper', () => {
    it('refuses a header carried over to a changed body, target, method or a missing header', async () => {
      const { header, request } = await signedCall('/messages?since=1', { method: 'POST', body: '{"a":1}' });
      expect(await verifiesV2(header, request)).toBe(true);
      expect(await verifiesV2(header, { ...request, body: new TextEncoder().encode('{"a":2}') })).toBe(false);
      expect(await verifiesV2(header, { ...request, target: '/api/messages?since=2' })).toBe(false);
      expect(await verifiesV2(header, { ...request, target: '/api/messages?since=%31' })).toBe(false);
      expect(await verifiesV2(header, { ...request, method: 'PUT' })).toBe(false);
      expect(await verifiesV2(header!.replace('Postern2 ', 'Postern '), request)).toBe(false);
      expect(await verifiesV2(null, request)).toBe(false);
    });
  });
});
