// src/services/apiAuth.ts — the one place every /api call goes through
// (docs/api.md's Authentication): with an unlocked key, fetches a fresh nonce
// from GET /api/challenge and signs the whole request with it (the v2 scheme:
// "postern-v2", the method, the request target as sent, the hex sha256 of the
// body and the nonce, joined by "\n"; @bsv/sdk PrivateKey.sign(message).toDER('hex'),
// matching the backend's VerifySignature — a single sha256 of the message's
// UTF-8 bytes), attaching "Authorization: Postern2 <pubkeyHex>:<nonceHex>:<sigHex>".
// So a header proves one request only. A nonce is single-use, so every
// authenticated call signs its own fresh one.
// "Licence required" is thrown only when the backend's 401 says no licence is
// held (its body's machine-readable "reason", docs/api.md), or names no reason
// (an older backend). A nonce refusal is retried once with a fresh challenge; a
// failed challenge says the backend could not be reached (mw-t64a3.25).
import { Hash, PrivateKey, Utils } from '@bsv/sdk';
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
 * stops when the response's headers arrive, so a long-lived stream is not cut;
 * any other body is read here, and given up on the same way once no byte of it
 * has come for API_TIMEOUT_MS (a link that drops large packets sends the headers
 * and never the rest, and a caller left reading it would wait for good). */
async function fetchWithin(fetchImpl: typeof fetch, url: string, init: RequestInit | undefined, sent: boolean): Promise<Response> {
  const controller = new AbortController();
  const caller = init?.signal;
  if (caller) {
    if (caller.aborted) controller.abort(caller.reason);
    else caller.addEventListener('abort', () => controller.abort(caller.reason), { once: true });
  }
  const response = await withTimeout(Promise.resolve(fetchImpl(url, { ...init, signal: controller.signal })), sent, API_TIMEOUT_MS, () => controller.abort());
  const stream = new Headers(init?.headers).get('Accept')?.includes('text/event-stream') ?? false;
  return stream ? response : readWithin(response, sent, () => controller.abort());
}

/** Statuses whose Response may carry no body. */
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

/** The response with its body read whole, each read allowed API_TIMEOUT_MS; an event stream is handed back as it is. */
async function readWithin(response: Response, sent: boolean, abort: () => void): Promise<Response> {
  if (!response.body || NULL_BODY.has(response.status) || response.headers.get('Content-Type')?.startsWith('text/event-stream')) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { value, done } = await withTimeout(reader.read(), sent, API_TIMEOUT_MS, abort);
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** The backend, or the proxy in front of it, did not answer a call as a working backend does
 * (no sign-in code, or a 502/503/504 from the gateway): the call can be retried by another way. */
export class BackendUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendUnreachableError';
  }
}

/** The backend answered and said no, with its own words and HTTP status. A 4xx (other than 408 and
 * 429) is a permanent refusal: sending the same thing again gets the same answer (mw-jrx0s.21). */
export class RefusedError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'RefusedError';
  }
}

/** Whether `err` is the backend refusing for good: a 4xx other than a request timeout (408) or too many requests (429).
 * A lost connection, a timeout, a gateway error and any 5xx are not: they are tried again, in their place. */
export function isPermanentRefusal(err: unknown): err is RefusedError {
  return err instanceof RefusedError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429;
}

export interface ApiFetchOptions {
  /** This phone's unlocked raw master key. Omitted for an unauthenticated call. */
  unlockedKey?: Uint8Array;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/** What the backend's GET /api/challenge issues: plain hex (docs/api.md). */
export const NONCE_SHAPE = /^[0-9a-f]{32,128}$/;

/** The bytes a request's body hashes as: a string's UTF-8 bytes, a buffer's (or view's) bytes as they are, none for no body.
 * The app sends only a JSON string or an ArrayBuffer; anything else is refused here, before anything is signed or sent, rather than signed over the wrong bytes. */
function bodyBytes(body: RequestInit['body']): Uint8Array {
  if (body === undefined || body === null) return new Uint8Array(0);
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  // Not instanceof: a buffer made in another realm (a test's, a worker's) is still one.
  if (Object.prototype.toString.call(body) === '[object ArrayBuffer]') return new Uint8Array(body as ArrayBuffer);
  throw new Error('This request has a body of a kind that cannot be signed; nothing was sent.');
}

/** The request target as it goes on the request line: path and query as written, no scheme or host. */
function requestTarget(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '');
}

/** Bodies up to this size are hashed in script, in one go; larger ones (a blob) by crypto.subtle off the main thread. */
const SYNC_HASH_LIMIT = 64 * 1024;

/** The lower-case hex SHA-256 of `bytes`. A small body is hashed without yielding, so a call's timers
 * start the moment its challenge is answered, as they did when only the nonce was signed. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (bytes.length <= SYNC_HASH_LIMIT) return Utils.toHex(Hash.sha256(Array.from(bytes)));
  // Re-wrapped: a buffer from another realm fails crypto.subtle's instance check.
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Utils.toHex(Array.from(new Uint8Array(digest)));
}

async function signedAuthorizationHeader(
  unlockedKey: Uint8Array,
  apiBase: string,
  fetchImpl: typeof fetch,
  request: { method: string; target: string; body: Uint8Array },
): Promise<string> {
  const privateKey = PrivateKey.fromHex(Utils.toHex(Array.from(unlockedKey)));
  const challengeResponse = await fetchWithin(fetchImpl, `${apiBase}/challenge`, undefined, false);
  if (!challengeResponse.ok) throw new BackendUnreachableError(`The backend could not be reached for a sign-in code (it answered ${challengeResponse.status}). Try again in a moment.`);
  const { nonce } = (await challengeResponse.json()) as { nonce: unknown };
  // The same key signs a hands step's approval (docs/protocol.md §17). A
  // backend that could get anything signed as a "nonce" could get an approval
  // signed without asking him, so only a plain hex nonce — what the backend
  // issues — is ever signed, and only inside the postern-v2 message.
  if (typeof nonce !== 'string' || !NONCE_SHAPE.test(nonce)) throw new Error('The backend sent a challenge that is not a nonce; nothing was signed.');
  const message = `postern-v2\n${request.method}\n${request.target}\n${await sha256Hex(request.body)}\n${nonce}`;
  const signature = privateKey.sign(message).toDER('hex') as string;
  return `Postern2 ${privateKey.toPublicKey().toString()}:${nonce}:${signature}`;
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
  if (!signed || reason === undefined || reason === 'no_licence') return new RefusedError('Licence required', 401);
  if (reason === 'nonce') {
    return new RefusedError("The backend twice rejected this phone's one-time sign-in code. Nothing was lost; try again.", 401);
  }
  return new RefusedError("The backend did not accept this phone's proof of who it is. Try again.", 401);
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
  const url = `${apiBase}${path}`;
  const request = options.unlockedKey ? { method, target: requestTarget(url), body: bodyBytes(init?.body) } : undefined;

  const attempt = async (): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if (options.unlockedKey && request) {
      headers.set('Authorization', await signedAuthorizationHeader(options.unlockedKey, apiBase, fetchImpl, request));
    }
    return fetchWithin(fetchImpl, url, { ...init, headers }, sent);
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
