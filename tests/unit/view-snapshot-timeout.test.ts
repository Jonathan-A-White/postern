// tests/unit/view-snapshot-timeout.test.ts — mw-q6n8m0.15: the §7 snapshot is the one view fetch that does not go
// through apiFetch, so it is bounded here: a /snapshot that never answers, or answers and never sends its body,
// is given up on after API_TIMEOUT_MS and its request aborted, like every /api call.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_TIMEOUT_MS, ApiTimeoutError } from '../../src/services/apiAuth';
import { refreshView, resetViewThrottle } from '../../src/services/view';

const key = new Uint8Array(32).fill(7);

beforeEach(() => {
  resetViewThrottle();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the snapshot fetch is bounded (mw-q6n8m0.15)', () => {
  it('gives up on a /snapshot that never answers, and aborts it', async () => {
    let aborted = false;
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const refreshed = refreshView({ key, live: false, why: 'poll', force: true, fetchImpl: fetchImpl as typeof fetch });
    const outcome = expect(refreshed).rejects.toBeInstanceOf(ApiTimeoutError);
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    await outcome;
    expect(aborted).toBe(true);
  });

  it('gives up on a /snapshot whose body never comes', async () => {
    let aborted = false;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            controller.error(new DOMException('aborted', 'AbortError'));
          });
        },
      });
      return new Response(body, { status: 200 });
    });
    const refreshed = refreshView({ key, live: false, why: 'poll', force: true, fetchImpl: fetchImpl as typeof fetch });
    const outcome = expect(refreshed).rejects.toBeInstanceOf(ApiTimeoutError);
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    await outcome;
    expect(aborted).toBe(true);
  });
});
