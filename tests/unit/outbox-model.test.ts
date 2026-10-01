// tests/unit/outbox-model.test.ts — mw-jrx0s.10: how long a failed send waits, and which of his
// messages still read as pending bubbles.
import { describe, expect, it } from 'vitest';
import type { MessageRow, OutboxRow } from '../../src/data/db';
import { anyPending, pendingAction, pendingAnswer, pendingMessageItems, retryDelay } from '../../src/model/outbox';

function row(over: Partial<OutboxRow>): OutboxRow {
  return { id: 1, kind: 'message', bead: '', payload: { text: 'hi', files: [] }, created: 1000, attempts: 0, state: 'pending', ...over };
}

describe('retryDelay', () => {
  it('doubles from two seconds and stops at a minute', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(retryDelay)).toEqual([2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000, 60_000]);
  });
});

describe('what is pending', () => {
  it('finds an answer to the same bead asked no later than the tap, and an action by name', () => {
    const rows = [row({ kind: 'answer', bead: 'mw-a', created: 5000 }), row({ id: 2, kind: 'action', bead: 'mw-b', payload: { action: { action: 'hold', bead: 'mw-b' } } })];
    expect(pendingAnswer(rows, 'mw-a', 4000)).toBe(rows[0]);
    expect(pendingAnswer(rows, 'mw-a', 6000)).toBeUndefined();
    expect(pendingAnswer(rows, 'mw-b', 0)).toBeUndefined();
    expect(pendingAction(rows, 'mw-b', 'hold')).toBe(rows[1]);
    expect(pendingAction(rows, 'mw-b', 'release')).toBeUndefined();
  });

  it('says the status line has something to say only once a try has failed', () => {
    expect(anyPending([row({ attempts: 0 })])).toBe(false);
    expect(anyPending([row({ attempts: 1 })])).toBe(true);
    expect(anyPending([row({ attempts: 1, state: 'sent' })])).toBe(false);
  });
});

describe('pendingMessageItems', () => {
  const kept = { txid: 'direct:1' } as MessageRow;

  it('shows a pending message and a sent one whose record is not kept, in their own thread only', () => {
    const rows = [row({ id: 1, thread: 'topic:ops' }), row({ id: 2, state: 'sent', txid: 'direct:2', thread: 'topic:ops' }), row({ id: 3, thread: 'topic:other' })];
    const items = pendingMessageItems(rows, [], (thread) => thread === 'topic:ops');
    expect(items.map((item) => item.id)).toEqual(['outbox:1', 'outbox:2']);
    expect(items.every((item) => item.pending && item.speaker === 'you')).toBe(true);
  });

  it('leaves out one whose record is kept, and an acked one', () => {
    const rows = [row({ id: 1, state: 'sent', txid: 'direct:1' }), row({ id: 2, state: 'acked', txid: 'direct:2' })];
    expect(pendingMessageItems(rows, [kept], () => true)).toEqual([]);
  });

  it('names the files that go with the text and the post a reply answers', () => {
    const [item] = pendingMessageItems([row({ payload: { text: 'look', files: [{ name: 'a.png' }, { name: 'b.png' }], re: 'abc' } })], [], () => true);
    expect(item.text).toBe('look\n\n_Files: a.png, b.png_');
    expect(item.re).toBe('abc');
  });
});

describe('a refused row (mw-jrx0s.21)', () => {
  it('still holds its card dead, but is not counted as waiting for the network', () => {
    const failed = row({ kind: 'answer', bead: 'mw-a', created: 5000, state: 'failed', attempts: 1, failure: 'unknown class' });
    expect(pendingAnswer([failed], 'mw-a', 4000)).toBe(failed);
    expect(anyPending([failed])).toBe(false);
  });

  it('shows a refused message as a bubble that says what the backend said', () => {
    const [item] = pendingMessageItems([row({ id: 4, state: 'failed', failure: 'too big' })], [], () => true);
    expect(item).toMatchObject({ id: 'outbox:4', outboxId: 4, failure: 'too big' });
  });
});
