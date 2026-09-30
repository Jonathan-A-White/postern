// mw-gq6.158: a Talk row shows the newest entry the thread itself shows, a bead's
// comment (a Mayor note) included, not only the newest Postern message.
import { describe, expect, it } from 'vitest';
import type { MessageRow } from '../../src/data/db';
import { summariseThreads } from '../../src/model/threads';
import type { BeadComment } from '../../src/model/view';

const T1 = Date.UTC(2026, 8, 29, 18, 44);
const T2 = Date.UTC(2026, 8, 30, 13, 59);
const NOW = Date.UTC(2026, 8, 30, 23);

function message(thread: string, at: number, text: string): MessageRow {
  return {
    id: `${thread}:${at}:0`,
    txid: `${thread}:${at}`.padEnd(64, '0'),
    vout: 0,
    seq: 1,
    class: 'message',
    to: '',
    from: '',
    ts: Math.floor(at / 1000),
    ciphertext: '',
    plaintext: text,
    direction: 'received',
    read: true,
    thread,
  };
}

const note = (at: number, text: string): BeadComment => ({ author: 'mayor', at: new Date(at).toISOString(), text });
const rowFor = (threads: ReturnType<typeof summariseThreads>, key: string) => threads.find((t) => t.key === key)!;

describe('summariseThreads: the newest entry the thread shows', () => {
  it('uses a newer bead comment for the row time and preview', () => {
    const threads = summariseThreads([message('bead:a', T1, 'Fixed, close on review')], undefined, {}, NOW, new Map([['bead:a', [note(T2, 'Answered on Postern 13:54')]]]));
    const row = rowFor(threads, 'bead:a');
    expect(row.latest).toMatchObject({ at: T2, preview: 'Answered on Postern 13:54', sent: false });
  });

  it('orders the list by that newest entry', () => {
    const messages = [message('bead:a', T1, 'older message'), message('bead:b', T1 + 60_000, 'newer message')];
    const threads = summariseThreads(messages, undefined, {}, NOW, new Map([['bead:a', [note(T2, 'a fresh note')]]]));
    expect(threads.filter((t) => t.key !== 'general').map((t) => t.key)).toEqual(['bead:a', 'bead:b']);
  });

  it('keeps a newer message over an older comment, and a message-only thread as before', () => {
    const messages = [message('bead:a', T2, 'the later message'), message('bead:b', T1, 'only a message')];
    const threads = summariseThreads(messages, undefined, {}, NOW, new Map([['bead:a', [note(T1, 'an older note')]]]));
    expect(rowFor(threads, 'bead:a').latest).toMatchObject({ at: T2, preview: 'the later message' });
    expect(rowFor(threads, 'bead:b').latest).toMatchObject({ at: T1, preview: 'only a message' });
    expect(rowFor(summariseThreads(messages, undefined, {}, NOW), 'bead:b').latest?.at).toBe(T1);
  });
});
