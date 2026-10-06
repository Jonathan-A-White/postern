// An emergency events record's push in the real service worker (src/sw.ts under
// tests/support/sw-harness.ts, docs/protocol.md §22): it shows at once, even over an open app
// (the banner is not waited for), stays until dealt with, and a tap lands in the app.
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/data/db';
import { EMERGENCY_TAG, EMERGENCY_TITLE, notificationSpecForEmergency } from '../../src/push/classOptions';
import { fakeWindowClient, loadWorker, type WorkerHarness } from '../support/sw-harness';

const TXID = `direct:${'cd'.repeat(32)}`;

let worker: WorkerHarness;

beforeEach(async () => {
  worker = await loadWorker();
  await db.settings.clear();
});

describe('the emergency notification', () => {
  it('is loud and stays until dismissed, one tag, re-alerting on a repeat', () => {
    const spec = notificationSpecForEmergency(TXID);
    expect(spec.title).toBe(EMERGENCY_TITLE);
    expect(spec.options).toMatchObject({ tag: EMERGENCY_TAG, renotify: true, requireInteraction: true, silent: false });
    expect(spec.options.vibrate?.length).toBeGreaterThan(0);
    expect(spec.options.data).toEqual({ txid: TXID, class: 'events', url: '/?v=emergency' });
  });
});

describe('an emergency push', () => {
  it('shows the emergency notification, even while the app is open on his screen', async () => {
    worker.openWindows.push(fakeWindowClient('https://postern.allmymind.org/?v=map'));
    await worker.push({ class: 'events', txid: TXID, ts: 1_790_000_000, title: 'Emergency' });
    expect(worker.shown).toHaveLength(1);
    expect(worker.shown[0].title).toBe('Emergency');
    expect(worker.shown[0].options).toMatchObject({ tag: EMERGENCY_TAG, requireInteraction: true });
    expect(worker.openWindows[0].postMessage).not.toHaveBeenCalled();
  });

  it('opens the app on a tap, in the open window if there is one', async () => {
    await worker.push({ class: 'events', txid: TXID, ts: 1_790_000_000, title: 'Emergency' });
    const app = fakeWindowClient();
    worker.openWindows.push(app);
    await worker.click(worker.open[worker.open.length - 1]);
    expect(app.postMessage).toHaveBeenCalledWith({ type: 'open', url: '/?v=emergency' });
    expect(app.focus).toHaveBeenCalled();
  });
});
