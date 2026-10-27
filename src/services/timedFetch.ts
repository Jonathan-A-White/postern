// src/services/timedFetch.ts — a fetch that is given up on: every call to the backend or to the chain provider
// goes through here, so none can wait for ever (mw-t64a3.7, mw-gb92lmo). Kept apart from apiAuth.ts so the
// outbox and the chain readers need nothing of the signing, and a test that doubles apiAuth leaves them alone.

/** How long any /api call may go unanswered before it is given up on: one
 * number for the challenge, the message post and the rest; a big body (a blob
 * upload) is given its crossing on top (requestTimeoutMs, mw-o14xubc). */
export const API_TIMEOUT_MS = 30_000;

/** The slowest uplink an upload is given time for, in bytes a second (mw-o14xubc: his camera pictures outran the 30 s on a
 * weak signal, and a try that is cut sends nothing, so the row was tried for ever): a request whose body is bigger than
 * SMALL_BODY_BYTES is allowed its crossing at this pace on top of API_TIMEOUT_MS before it is given up on. */
export const UPLOAD_BYTES_PER_SECOND = 10_000;
/** A body this size or smaller crosses well inside API_TIMEOUT_MS and gets no more. */
export const SMALL_BODY_BYTES = 64_000;

/** How long a request carrying `bodyBytes` may go unanswered: API_TIMEOUT_MS, plus the time the slowest uplink takes to carry a body
 * bigger than SMALL_BODY_BYTES, in whole seconds. */
export function requestTimeoutMs(bodyBytes: number): number {
  if (bodyBytes <= SMALL_BODY_BYTES) return API_TIMEOUT_MS;
  return API_TIMEOUT_MS + Math.ceil(bodyBytes / UPLOAD_BYTES_PER_SECOND) * 1000;
}

/** The bytes a request's body is, as far as the timing cares: a string's characters, a buffer's length, a Blob's size, 0 for none or a kind it cannot measure. */
export function bodyLength(body: RequestInit['body']): number {
  if (body === undefined || body === null) return 0;
  if (typeof body === 'string') return body.length;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (Object.prototype.toString.call(body) === '[object ArrayBuffer]') return (body as ArrayBuffer).byteLength;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body.size;
  return 0;
}

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

/** One fetch (to the backend or to the chain provider) that is aborted, and rejected with an ApiTimeoutError, if no
 * response arrives in time: API_TIMEOUT_MS, and a big body's crossing on top (requestTimeoutMs). A caller's own signal still aborts it. The timer
 * stops when the response's headers arrive, so a long-lived stream is not cut;
 * any other body is read here, and given up on the same way once no byte of it
 * has come for API_TIMEOUT_MS (a link that drops large packets sends the headers
 * and never the rest, and a caller left reading it would wait for good). */
export async function fetchWithin(fetchImpl: typeof fetch, url: string, init: RequestInit | undefined, sent: boolean): Promise<Response> {
  const controller = new AbortController();
  const caller = init?.signal;
  if (caller) {
    if (caller.aborted) controller.abort(caller.reason);
    else caller.addEventListener('abort', () => controller.abort(caller.reason), { once: true });
  }
  const response = await withTimeout(Promise.resolve(fetchImpl(url, { ...init, signal: controller.signal })), sent, requestTimeoutMs(bodyLength(init?.body)), () => controller.abort());
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
