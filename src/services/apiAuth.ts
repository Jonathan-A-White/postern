// src/services/apiAuth.ts — the one place every /api call goes through
// (docs/api.md's Authentication): with an unlocked key, fetches a fresh nonce
// from GET /api/challenge and signs it (@bsv/sdk PrivateKey.sign(nonce).toDER('hex'),
// matching the backend's VerifySignature — a single sha256 of the nonce
// string's UTF-8 bytes), attaching "Authorization: Postern <pubkeyHex>:<nonceHex>:<sigHex>".
// A nonce is single-use, so every authenticated call signs its own fresh one.
// "Licence required" is thrown only when the backend's 401 says no licence is
// held (its body's machine-readable "reason", docs/api.md), or names no reason
// (an older backend). A nonce refusal is retried once with a fresh challenge; a
// failed challenge says the backend could not be reached (mw-t64a3.25).
import { PrivateKey, Utils } from '@bsv/sdk';
import { API_BASE } from './messages';
import { noteApiResponse } from './standby';

/** How long any /api call may go unanswered before it is given up on: one
 * number for the challenge, the blob upload, the message post and the rest. */
export const API_TIMEOUT_MS = 30_000;

/** An /api call the backend did not answer in time. `sent` is whether the
 * request itself (not just its challenge) went out and could have been acted on
 * (a POST): then the outcome is unknown, otherwise nothing was done. */
export class ApiTimeoutError extends Error {
  readonly sent: boolean;
  constructor(sent: boolean) {
    super('The backend did not answer in time.');
    this.sent = sent;
    this.name = 'ApiTimeoutError';
  }
}

/** Settles like `work`, or rejects with an ApiTimeoutError once `ms` have passed.
 * `onTimeout` (an abort) runs after the rejection is issued: aborting a fetch
 * rejects it at once with the browser's AbortError, which must not win the race. */
export function withTimeout<T>(work: Promise<T>, sent: boolean, ms = API_TIMEOUT_MS, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ApiTimeoutError(sent));
      onTimeout?.();
    }, ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

/** One fetch that is aborted, and rejected with an ApiTimeoutError, if no
 * response arrives in time. A caller's own signal still aborts it. The timer
 * stops when the response's headers arrive, so a long-lived stream is not cut. */
function fetchWithin(fetchImpl: typeof fetch, url: string, init: RequestInit | undefined, sent: boolean): Promise<Response> {
  const controller = new AbortController();
  const caller = init?.signal;
  if (caller) {
    if (caller.aborted) controller.abort(caller.reason);
    else caller.addEventListener('abort', () => controller.abort(caller.reason), { once: true });
  }
  return withTimeout(Promise.resolve(fetchImpl(url, { ...init, signal: controller.signal })), sent, API_TIMEOUT_MS, () => controller.abort());
}

export interface ApiFetchOptions {
  /** This phone's unlocked raw master key. Omitted for an unauthenticated call. */
  unlockedKey?: Uint8Array;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/** What the backend's GET /api/challenge issues: plain hex (docs/api.md). */
export const NONCE_SHAPE = /^[0-9a-f]{32,128}$/;

async function signedAuthorizationHeader(
  unlockedKey: Uint8Array,
  apiBase: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const privateKey = PrivateKey.fromHex(Utils.toHex(Array.from(unlockedKey)));
  const challengeResponse = await fetchWithin(fetchImpl, `${apiBase}/challenge`, undefined, false);
  if (!challengeResponse.ok) throw new Error(`The backend could not be reached for a sign-in code (it answered ${challengeResponse.status}). Try again in a moment.`);
  const { nonce } = (await challengeResponse.json()) as { nonce: unknown };
  // The same key signs a hands step's approval (docs/protocol.md §17). A
  // backend that could get anything signed as a "nonce" could get an approval
  // signed without asking him, so only a plain hex nonce — what the backend
  // issues — is ever signed.
  if (typeof nonce !== 'string' || !NONCE_SHAPE.test(nonce)) throw new Error('The backend sent a challenge that is not a nonce; nothing was signed.');
  const signature = privateKey.sign(nonce).toDER('hex') as string;
  return `Postern ${privateKey.toPublicKey().toString()}:${nonce}:${signature}`;
}

/** The "reason" a backend 401 names (docs/api.md), or undefined from an older backend. */
async function refusalReason(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.clone().json()) as { reason?: unknown };
    return typeof body.reason === 'string' ? body.reason : undefined;
  } catch {
    return undefined;
  }
}

/** What a 401 says. Only a backend that says no licence is held (or, being older,
 * names no reason) is a licence problem; any other refusal of a signed call is
 * about the proof, and says so. */
function refusalError(reason: string | undefined, signed: boolean): Error {
  if (!signed || reason === undefined || reason === 'no_licence') return new Error('Licence required');
  if (reason === 'nonce') {
    return new Error("The backend twice rejected this phone's one-time sign-in code. Nothing was lost; try again.");
  }
  return new Error("The backend did not accept this phone's proof of who it is. Try again.");
}

/**
 * Fetches `${apiBase}${path}`, attaching a signed proof header when
 * `unlockedKey` is given. A 401 whose reason is a refused nonce is retried once
 * with a fresh challenge (the backend refuses before acting, so a POST is safe
 * to send again); a 401 becomes "Licence required" only when no licence is held.
 */
export async function apiFetch(
  path: string,
  init: RequestInit | undefined,
  options: ApiFetchOptions,
): Promise<Response> {
  const apiBase = options.apiBase ?? API_BASE;
  const fetchImpl = options.fetchImpl ?? fetch;
  const method = (init?.method ?? 'GET').toUpperCase();
  const sent = method !== 'GET' && method !== 'HEAD';

  const attempt = async (): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if (options.unlockedKey) {
      headers.set('Authorization', await signedAuthorizationHeader(options.unlockedKey, apiBase, fetchImpl));
    }
    return fetchWithin(fetchImpl, `${apiBase}${path}`, { ...init, headers }, sent);
  };

  let response = await attempt();
  if (response.status === 401) {
    let reason = await refusalReason(response);
    if (options.unlockedKey && reason === 'nonce') {
      response = await attempt();
      reason = response.status === 401 ? await refusalReason(response) : undefined;
    }
    if (response.status === 401) throw refusalError(reason, options.unlockedKey !== undefined);
  }
  await noteApiResponse(path, response);
  return response;
}
