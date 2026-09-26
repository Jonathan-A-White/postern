import { describe, it, expect } from 'vitest';
import { summarizeThreads, titleForThread } from '../../src/threads/grouping';
import type { MessageRow } from '../../src/data/db';
import type { Snapshot } from '../../src/services/questions';

function message(overrides: Partial<MessageRow> & { id: string }): MessageRow {
  return {
    txid: overrides.id,
    vout: 0,
    seq: 1,
    class: 'message',
    to: 'to',
    from: 'from',
    ts: 0,
    ciphertext: 'ct',
    direction: 'received',
    read: false,
    ...overrides,
  };
}

function snapshotNaming(beadId: string, title: string): Snapshot {
  return {
    written_at: '2026-09-25T00:00:00Z',
    epics: [
      {
        id: 'mw-epic',
        title: 'The epic',
        priority: 'P1',
        status: 'in-progress',
        needs_you: [{ id: beadId, title, asked_at: '2026-09-25T00:00:00Z', recommended: 'a', options: ['a'] }],
        landed: [],
        working: [],
        closed_count: 0,
      },
    ],
  };
}

describe('titleForThread', () => {
  it('is "General" for the general thread', () => {
    expect(titleForThread(undefined, undefined)).toBe('General');
  });

  it("is a topic's own name", () => {
    expect(titleForThread({ topic: 'launch plan' }, undefined)).toBe('launch plan');
  });

  it("is a bead's title from the snapshot when known there", () => {
    const snapshot = snapshotNaming('mw-xyz12.3', 'Ship the walking skeleton');
    expect(titleForThread({ bead: 'mw-xyz12.3' }, snapshot)).toBe('Ship the walking skeleton');
  });

  it('falls back to the bead id when the snapshot does not name it', () => {
    expect(titleForThread({ bead: 'mw-xyz12.3' }, undefined)).toBe('mw-xyz12.3');
    const snapshot = snapshotNaming('mw-other', 'Something else');
    expect(titleForThread({ bead: 'mw-xyz12.3' }, snapshot)).toBe('mw-xyz12.3');
  });
});

describe('summarizeThreads', () => {
  it('orders threads by newest activity, with the general thread last regardless of its own activity', () => {
    const messages: MessageRow[] = [
      message({ id: 'bead', thread: 'bead:mw-xyz12.3', ts: 100 }),
      message({ id: 'general', thread: undefined, ts: 250 }),
      message({ id: 'topic', thread: 'topic:launch plan', ts: 200 }),
    ];
    const summaries = summarizeThreads(messages, undefined);
    expect(summaries.map((s) => s.title)).toEqual(['launch plan', 'mw-xyz12.3', 'General']);
  });

  it('titles a bead thread from the snapshot', () => {
    const snapshot = snapshotNaming('mw-xyz12.3', 'Ship the walking skeleton');
    const summaries = summarizeThreads([message({ id: 'a', thread: 'bead:mw-xyz12.3', ts: 100 })], snapshot);
    expect(summaries[0].title).toBe('Ship the walking skeleton');
  });

  it('counts only unread received messages per thread', () => {
    const messages: MessageRow[] = [
      message({ id: 'a', thread: 'topic:x', ts: 1, direction: 'received', read: false }),
      message({ id: 'b', thread: 'topic:x', ts: 2, direction: 'received', read: true }),
      message({ id: 'c', thread: 'topic:x', ts: 3, direction: 'sent', read: false }),
    ];
    const summaries = summarizeThreads(messages, undefined);
    expect(summaries[0].unreadCount).toBe(1);
  });

  it('returns nothing for no messages', () => {
    expect(summarizeThreads([], undefined)).toEqual([]);
  });
});
