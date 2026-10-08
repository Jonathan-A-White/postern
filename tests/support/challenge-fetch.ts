// tests/support/challenge-fetch.ts — a GET /api/challenge double (docs/api.md),
// shared by every test whose fetch stub now sees this extra request: apiFetch
// (src/services/apiAuth.ts) fetches a fresh nonce before signing any
// authenticated call.
import { PublicKey, Signature, Utils } from '@bsv/sdk';

export function challengeResponse(nonce = 'a'.repeat(64)): Response {
  return new Response(JSON.stringify({ nonce }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function isChallengeRequest(url: string): boolean {
  return url.endsWith('/challenge');
}

// A v2-verifying double (docs/api.md's Authentication): checks a 'Postern2'
// Authorization header the way the backend does, over the request AS RECEIVED,
// so a header carried over to a different method, target or body is refused.

export interface ReceivedRequest {
  method: string;
  /** The request target exactly as it went on the request line: path and query. */
  target: string;
  body: Uint8Array;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Utils.toHex(Array.from(new Uint8Array(digest)));
}

/** The message a v2 header signs for `request` and `nonce`. */
export async function v2Message(request: ReceivedRequest, nonce: string): Promise<string> {
  return `postern-v2\n${request.method}\n${request.target}\n${await sha256Hex(request.body)}\n${nonce}`;
}

/** Whether `header` is 'Postern2 <pubkey>:<nonce>:<sig>' with a signature by that pubkey over exactly `request`'s v2 message. */
export async function verifiesV2(header: string | null, request: ReceivedRequest): Promise<boolean> {
  const match = header?.match(/^Postern2 ([0-9a-f]+):([0-9a-f]+):([0-9a-f]+)$/);
  if (!match) return false;
  const [, pubkeyHex, nonce, sigHex] = match;
  return PublicKey.fromString(pubkeyHex).verify(await v2Message(request, nonce), Signature.fromDER(sigHex, 'hex'));
}

/** A request as a fetch stub receives it: the URL and init, reduced to what v2 signs. */
export function receivedRequest(input: RequestInfo | URL, init?: RequestInit): ReceivedRequest {
  const body = init?.body;
  let bytes = new Uint8Array(0);
  if (typeof body === 'string') bytes = new TextEncoder().encode(body);
  else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
  else if (body != null) throw new Error('the double only knows string and ArrayBuffer bodies');
  return { method: (init?.method ?? 'GET').toUpperCase(), target: String(input), body: bytes };
}
