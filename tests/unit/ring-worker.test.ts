// The Mayor's ring in the real service worker (src/sw.ts under tests/support/sw-harness.ts, docs/protocol.md §21):
// it rings even over an open app, Answer or the body opens the Talk line naming the ring, and Later sends the tap
// to an open window or keeps it in IndexedDB for the next open, opening nothing.
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/data/db';
import { settingsRepo } from '../../src/data/repositories/settings-repo';
import { fakeWindowClient, loadWorker, type WorkerHarness } from '../support/sw-harness';

const RING = `direct:${'ab'.repeat(32)}`;

let worker: WorkerHarness;

beforeEach(async () => {
  worker = await loadWorker();
  await db.settings.clear();
});

async function ring(): Promise<{ data?: unknown }> {
  await worker.push({ class: 'call', txid: RING, ts: 1_790_000_000, title: 'The Mayor is calling', body: 'Back now: two landings.' });
  return worker.open[worker.open.length - 1];
}

describe('a ring push', () => {
  it('shows the incoming-call notification, even while the app is open on his screen', async () => {
    worker.openWindows.push(fakeWindowClient('https://postern.allmymind.org/?v=line'));
    await ring();
    expect(worker.shown).toHaveLength(1);
    const { title, options } = worker.shown[0];
    expect(title).toBe('The Mayor is calling');
    expect(options).toMatchObject({
      body: 'Back now: two landings.',
      tag: 'mayor-call',
      renotify: true,
      requireInteraction: true,
      silent: false,
      actions: [
        { action: 'answer', title: 'Answer' },
        { action: 'later', title: 'Later' },
      ],
    });
    expect((options.vibrate as number[]).length).toBeGreaterThanOrEqual(20);
  });
});

describe('a tap on a ring', () => {
  it('on Answer opens the Talk line with the ring named', async () => {
    await worker.click(await ring(), 'answer');
    expect(worker.openWindow).toHaveBeenCalledWith(`/?v=line&call=${encodeURIComponent(RING)}`);
  });

  it('on the body does the same as Answer, in the open app if there is one', async () => {
    const app = fakeWindowClient();
    worker.openWindows.push(app);
    await worker.click(await ring(), '');
    expect(app.postMessage).toHaveBeenCalledWith({ type: 'open', url: `/?v=line&call=${encodeURIComponent(RING)}` });
    expect(app.focus).toHaveBeenCalled();
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it('on Later hands the tap to an open window to send, and opens nothing', async () => {
    const app = fakeWindowClient();
    worker.openWindows.push(app);
    await worker.click(await ring(), 'later');
    expect(app.postMessage).toHaveBeenCalledWith({ type: 'later', ring_txid: RING });
    expect(app.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'open' }));
    expect(app.focus).not.toHaveBeenCalled();
    expect(await settingsRepo.takePendingLaters()).toEqual([]);
  });

  it('on Later with no window open keeps the tap for the next open, and opens nothing', async () => {
    await worker.click(await ring(), 'later');
    expect(worker.openWindow).not.toHaveBeenCalled();
    expect(await settingsRepo.takePendingLaters()).toEqual([RING]);
  });
});
