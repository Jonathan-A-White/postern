// src/services/timedFetch.ts — a fetch that is given up on: every call to the backend or to the chain provider
// goes through here, so none can wait for ever (mw-t64a3.7, mw-gb92lmo). Kept apart from apiAuth.ts so the
// outbox and the chain readers need nothing of the signing, and a test that doubles apiAuth leaves them alone.

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

/** One fetch (to the backend or to the chain provider) that is aborted, and rejected with an ApiTimeoutError, if no
 * response arrives in time. A caller's own signal still aborts it. The timer
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
