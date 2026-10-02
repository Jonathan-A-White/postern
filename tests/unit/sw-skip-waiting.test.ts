// mw-yxwtth.1: the worker the app tells to take over does: SKIP_WAITING from a window makes it skip
// waiting, and on activate it claims the open windows, so the page's controllerchange fires.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWorker, type WorkerHarness } from '../support/sw-harness';

let worker: WorkerHarness;

beforeEach(async () => {
  worker = await loadWorker();
  // Activate also heals the precache (src/precacheGuard.ts); here there is nothing cached.
  Object.defineProperty(window, 'caches', { configurable: true, value: { keys: async () => [], open: vi.fn() } });
});

describe('the service worker taking over', () => {
  it("skips waiting on {type:'SKIP_WAITING'} from a window", async () => {
    await worker.deliver({ type: 'SKIP_WAITING' });
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('does not skip waiting for any other message', async () => {
    await worker.deliver({ type: 'seen', txid: 'a'.repeat(64), seen: true });
    await worker.deliver({ type: 'something-else' });
    await worker.deliver(undefined);
    expect(worker.skipWaiting).not.toHaveBeenCalled();
  });

  it('still closes the notification of a message the app has shown', async () => {
    const txid = 'b'.repeat(64);
    const close = vi.fn();
    worker.open.push({ tag: txid, data: { txid }, close });
    await worker.deliver({ type: 'SKIP_WAITING' });
    await worker.deliver({ type: 'seen', txid });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('claims the open windows on activate', async () => {
    await worker.activate();
    expect(worker.claim).toHaveBeenCalledTimes(1);
  });
});
