// src/services/apiAuth.ts — the one place every /api call goes through
// (docs/api.md's Authentication): with an unlocked key, fetches a fresh nonce
// from GET /api/challenge and signs it (@bsv/sdk PrivateKey.sign(nonce).toDER('hex'),
// matching the backend's VerifySignature — a single sha256 of the nonce
// string's UTF-8 bytes), attaching "Authorization: Postern <pubkeyHex>:<nonceHex>:<sigHex>".
// A nonce is single-use, so every authenticated call signs its own fresh one.
// Any 401 becomes a plain "Licence required" error, whether or not the call
// carried a proof.
import { PrivateKey, Utils } from '@bsv/sdk';
import { API_BASE } from './messages';

export interface ApiFetchOptions {
  /** This phone's unlocked raw master key. Omitted for an unauthenticated call. */
  unlockedKey?: Uint8Array;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

async function signedAuthorizationHeader(
  unlockedKey: Uint8Array,
  apiBase: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const privateKey = PrivateKey.fromHex(Utils.toHex(Array.from(unlockedKey)));
  const challengeResponse = await fetchImpl(`${apiBase}/challenge`);
  if (!challengeResponse.ok) throw new Error('Licence required');
  const { nonce } = (await challengeResponse.json()) as { nonce: string };
  const signature = privateKey.sign(nonce).toDER('hex') as string;
  return `Postern ${privateKey.toPublicKey().toString()}:${nonce}:${signature}`;
}

/**
 * Fetches `${apiBase}${path}`, attaching a signed proof header when
 * `unlockedKey` is given. Any 401 response becomes a plain "Licence
 * required" error, regardless of whether the call carried a proof.
 */
export async function apiFetch(
  path: string,
  init: RequestInit | undefined,
  options: ApiFetchOptions,
): Promise<Response> {
  const apiBase = options.apiBase ?? API_BASE;
  const fetchImpl = options.fetchImpl ?? fetch;

  const headers = new Headers(init?.headers);
  if (options.unlockedKey) {
    headers.set('Authorization', await signedAuthorizationHeader(options.unlockedKey, apiBase, fetchImpl));
  }

  const response = await fetchImpl(`${apiBase}${path}`, { ...init, headers });
  if (response.status === 401) throw new Error('Licence required');
  return response;
}
