// mw-9rp4hu.23: a push is shown from the database of the account its registration belongs to. Account 1 keeps the
// app's own registration (scope /); every other account has a push-only registration of its own
// (/push-account/<id>/, src/push/accountScope.ts), so the worker running there knows which account a push is for.
import { beforeEach, describe, expect, it } from 'vitest';
import { accountDb } from '../../src/data/db';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../../src/push/classOptions';
import { fakeWindowClient, loadWorker, type WorkerHarness } from '../support/sw-harness';

const TXID = `direct:${'ab'.repeat(32)}`;
const PUSH = { class: 'message', txid: TXID, ts: 1_790_000_000 };

async function keepSettings(accountId: string, quiet: boolean) {
  await accountDb(accountId).settings.put({
    key: 'notificationSettings',
    value: { message: { ...DEFAULT_NOTIFICATION_SETTINGS.message, quiet, sound: !quiet, vibrate: !quiet } },
  });
}

beforeEach(async () => {
  for (const id of ['1', '2', '3']) await accountDb(id).settings.clear();
});

describe('a push in the worker of one account', () => {
  it("reads account 2's notification switches for a push on account 2's registration, and account 1's for account 1's", async () => {
    await keepSettings('1', false);
    await keepSettings('2', true);

    const first: WorkerHarness = await loadWorker();
    await first.push(PUSH);
    expect(first.shown).toHaveLength(1);
    expect(first.shown[0].options).toMatchObject({ silent: false });
    expect(first.shown[0].options.vibrate).toBeDefined();

    const second = await loadWorker({ account: '2' });
    await second.push(PUSH);
    expect(second.shown).toHaveLength(1);
    expect(second.shown[0].options).toMatchObject({ silent: true });
    expect(second.shown[0].options.vibrate).toBeUndefined();
  });

  it("reads account 2's Reminders setting, not account 1's", async () => {
    await accountDb('1').settings.put({ key: 'reminderSettings', value: { sound: true } });
    await accountDb('2').settings.put({ key: 'reminderSettings', value: { sound: false } });
    const second = await loadWorker({ account: '2' });
    await second.push({ class: 'reminder', ts: 1_790_000_000, title: 'Due now' });
    expect(second.shown[0].options).toMatchObject({ silent: true });
    const first = await loadWorker();
    await first.push({ class: 'reminder', ts: 1_790_000_000, title: 'Due now' });
    expect(first.shown[0].options).toMatchObject({ silent: false });
  });

  it("opens a tap's thread from account 2's messages", async () => {
    await accountDb('2').messages.put({
      id: `${TXID}:0`, txid: TXID, vout: 0, seq: 1, class: 'message', to: 'a', from: 'b', ts: 1_790_000_000, ciphertext: 'x',
      plaintext: JSON.stringify({ body: 'hi' }), direction: 'received', read: false, thread: 'topic:two',
    });
    const first = await loadWorker();
    await first.push(PUSH);
    await first.click(first.open[0]);
    expect(first.openWindow).toHaveBeenCalledWith(expect.not.stringContaining('two'));
    const second = await loadWorker({ account: '2' });
    await second.push(PUSH);
    await second.click(second.open[0]);
    expect(second.openWindow).toHaveBeenCalledWith(expect.stringContaining('two'));
  });

  it("tells the window which account a tap is for, so it can switch to it", async () => {
    const second = await loadWorker({ account: '2' });
    const app = fakeWindowClient();
    second.openWindows.push(app);
    await second.push({ class: 'landing', ts: 1_790_000_000 });
    await second.click(second.open[0]);
    expect(app.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'open', account: '2' }));
  });

  it("tells the window which account a Later tap is for, and with no window parks it in account 2's own database", async () => {
    const second = await loadWorker({ account: '2' });
    const app = fakeWindowClient();
    second.openWindows.push(app);
    await second.push({ class: 'call', txid: 'direct:cc', ts: 1_790_000_000 });
    await second.click(second.open[0], 'later');
    expect(app.postMessage).toHaveBeenCalledWith({ type: 'later', ring_txid: 'direct:cc', account: '2' });

    second.openWindows.length = 0;
    await second.push({ class: 'call', txid: 'direct:dd', ts: 1_790_000_000 });
    await second.click(second.open[second.open.length - 1], 'later');
    expect((await accountDb('2').settings.get('pendingLaters'))?.value).toEqual(['direct:dd']);
    expect(await accountDb('1').settings.get('pendingLaters')).toBeUndefined();
  });
});
