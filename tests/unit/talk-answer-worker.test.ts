// The Mayor's talk answer, pushed with no words in it (docs/protocol.md §20, mw-j0f2d.38), in the
// real service worker (src/sw.ts under tests/support/sw-harness.ts): a notification titled
// "The Mayor answered" unless a window is showing the app, and a tap opens the Talk line.
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/data/db';
import { TALK_ANSWER_TAG, TALK_ANSWER_TITLE } from '../../src/push/classOptions';
import { fakeWindowClient, loadWorker, type WorkerHarness } from '../support/sw-harness';

const TXID = `direct:${'ef'.repeat(32)}`;

let worker: WorkerHarness;

beforeEach(async () => {
  worker = await loadWorker();
  await db.settings.clear();
});

describe('a talk answer push', () => {
  it('shows "The Mayor answered", with none of the answer\'s words, when no window is open', async () => {
    await worker.push({ class: 'talk', txid: TXID, ts: 1_790_000_000 });
    expect(worker.shown).toHaveLength(1);
    expect(worker.shown[0].title).toBe(TALK_ANSWER_TITLE);
    expect(worker.shown[0].title).toBe('The Mayor answered');
    expect(worker.shown[0].options).toMatchObject({ tag: TALK_ANSWER_TAG, renotify: true, silent: false });
    expect(worker.shown[0].options.body).toBeUndefined();
  });

  it('shows it when the app is open but hidden or not focused', async () => {
    const hidden = fakeWindowClient();
    hidden.visibilityState = 'hidden';
    const unfocused = fakeWindowClient();
    unfocused.focused = false;
    worker.openWindows.push(hidden, unfocused);
    await worker.push({ class: 'talk', txid: TXID, ts: 1_790_000_000 });
    expect(worker.shown).toHaveLength(1);
    expect(hidden.postMessage).not.toHaveBeenCalled();
  });

  it('shows none when a window is visible and focused', async () => {
    worker.openWindows.push(fakeWindowClient('https://postern.allmymind.org/?v=line'));
    await worker.push({ class: 'talk', txid: TXID, ts: 1_790_000_000 });
    expect(worker.shown).toHaveLength(0);
  });

  it('opens the Talk line on a tap, in the open window if there is one', async () => {
    await worker.push({ class: 'talk', txid: TXID, ts: 1_790_000_000 });
    const app = fakeWindowClient();
    app.visibilityState = 'hidden';
    worker.openWindows.push(app);
    await worker.click(worker.open[worker.open.length - 1]);
    expect(app.postMessage).toHaveBeenCalledWith({ type: 'open', url: '/?v=line' });
    expect(app.focus).toHaveBeenCalled();
  });

  it('opens a new window at the Talk line when the app is closed', async () => {
    await worker.push({ class: 'talk', txid: TXID, ts: 1_790_000_000 });
    await worker.click(worker.open[worker.open.length - 1]);
    expect(worker.openWindow).toHaveBeenCalledWith('/?v=line');
  });
});
