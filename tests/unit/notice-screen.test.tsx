// tests/unit/notice-screen.test.tsx — what the notice screen does while the app's
// own sync runs after a cold start (mw-gq6.163): it waits for that sync to finish
// rather than for a fixed time, asks for another when it brought nothing, and only
// then gives way to where the class belongs.
import '@testing-library/react/dont-cleanup-after-each';
import { useSyncExternalStore } from 'react';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, type MessageRow } from '../../src/data/db';
import { messagesRepo } from '../../src/data/repositories';
import { parseRoute } from '../../src/nav/route';
import { NoticeScreen } from '../../src/cockpit/NoticeScreen';

const live = vi.hoisted(() => {
  const state = { status: 'connecting', me: null, reconnects: 0, syncs: 0 };
  const listeners = new Set<() => void>();
  return {
    state,
    listeners,
    refreshNow: vi.fn(async () => {}),
    /** One sync of the app's own finishing. */
    settle() {
      live.state = { ...live.state, syncs: live.state.syncs + 1 };
      for (const listener of listeners) listener();
    },
  };
});
vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  getLiveState: () => live.state,
  useLive: () =>
    useSyncExternalStore(
      (listener) => {
        live.listeners.add(listener);
        return () => live.listeners.delete(listener);
      },
      () => live.state,
    ),
  refreshNow: live.refreshNow,
}));

const TXID = 'cd'.repeat(32);
const POST = `direct:${'a1'.repeat(32)}`;

function general(txid: string, body: object | string): MessageRow {
  return {
    id: `${txid}:0`, txid, vout: 0, seq: 1, class: 'message', to: 'aa'.repeat(33), from: 'bb'.repeat(33), ts: 1_790_000_000,
    ciphertext: 'ct', plaintext: typeof body === 'string' ? body : JSON.stringify(body), direction: 'received', read: false, thread: undefined,
  };
}

const route = () => parseRoute(window.location.search);

beforeEach(async () => {
  cleanup();
  await db.messages.clear();
  live.state = { status: 'connecting', me: null, reconnects: 0, syncs: 0 };
  live.refreshNow.mockClear();
  window.history.replaceState(null, '', '/?v=notice&tx=' + TXID + '&cls=message');
});

describe('NoticeScreen while the app syncs', () => {
  it('asks the app to sync as soon as it opens', () => {
    render(<NoticeScreen tx={TXID} cls="message" />);
    expect(live.refreshNow).toHaveBeenCalledTimes(1);
  });

  it('does not give way to General after 8 s while no sync has finished', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      render(<NoticeScreen tx={TXID} cls="message" />);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(route()).toMatchObject({ view: 'notice' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks for one more sync when the first brought nothing, then gives way to the class\'s place: General for a message (a message that never arrives)', async () => {
    render(<NoticeScreen tx={TXID} cls="message" graceMs={20} />);
    act(() => live.settle());
    await waitFor(() => expect(live.refreshNow).toHaveBeenCalledTimes(2));
    expect(route()).toMatchObject({ view: 'notice' });
    act(() => live.settle());
    await waitFor(() => expect(route()).toEqual({ view: 'talk', thread: undefined }));
  });

  it('moves to the reply thread of the post when the sync brings the reply in', async () => {
    render(<NoticeScreen tx={TXID} cls="message" graceMs={20} />);
    await messagesRepo.put(general(POST, 'the post'));
    await messagesRepo.put(general(TXID, { text: 'the answer', re: POST }));
    act(() => live.settle());
    await waitFor(() => expect(route()).toEqual({ view: 'talk', thread: 'general', root: POST }));
  });

  it('gives way to the class\'s place at last when no sync ever finishes', async () => {
    render(<NoticeScreen tx={TXID} cls="decision-needed" waitMs={40} />);
    await waitFor(() => expect(route()).toEqual({ view: 'needs' }));
  });
});

afterAll(cleanup);
