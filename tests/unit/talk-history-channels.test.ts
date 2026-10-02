// mw-am3yjh.2: the Talk screen lists earlier talks from their stored rows, and those rows stay out of
// every channel: the Factory thread (general), a bead's thread, and the channel list's last posts and unread counts.
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type MessageRow } from '../../src/data/db';
import { messagesRepo } from '../../src/data/repositories';
import { summariseThreads } from '../../src/model/threads';
import { encodeTurn } from '../../src/services/talk';

function talkRow(id: string, ts: number, thread?: string): MessageRow {
  const turn = encodeTurn({ talk: { id: `talk-${ts}`, turn: 1 }, text: `Talk words ${ts}`, role: ts % 2 ? 'turn' : 'answer' });
  return { id, txid: id, vout: 0, seq: ts, class: 'talk', to: 'me', from: 'mayor', ts, ciphertext: '', plaintext: turn, direction: ts % 2 ? 'sent' : 'received', read: false, thread };
}
function postRow(id: string, ts: number, thread?: string): MessageRow {
  return { id, txid: id, vout: 0, seq: ts, class: 'message', to: 'me', from: 'mayor', ts, ciphertext: 'ct', plaintext: 'A real post', direction: 'received', read: true, thread };
}

beforeEach(async () => {
  await db.messages.clear();
});

describe('earlier talks and the channels', () => {
  const rows = [
    postRow('post-general', 10),
    postRow('post-bead', 11, 'bead:mw-1'),
    talkRow('t1', 100),
    talkRow('t2', 101, 'bead:mw-1'),
    talkRow('t3', 102),
    talkRow('t4', 103, 'bead:mw-1'),
  ];

  it('keeps talk rows out of the Factory thread and a bead thread', async () => {
    await db.messages.bulkPut(rows);
    expect((await messagesRepo.inThread(undefined)).map((row) => row.id)).toEqual(['post-general']);
    expect((await messagesRepo.inThread('bead:mw-1')).map((row) => row.id)).toEqual(['post-bead']);
  });

  it('keeps talk rows out of the channel list: no last post, preview or unread count comes from one', () => {
    const threads = summariseThreads(rows);
    expect(threads.map((thread) => thread.last?.id).filter(Boolean).sort()).toEqual(['post-bead', 'post-general']);
    expect(threads.reduce((sum, thread) => sum + thread.unread, 0)).toBe(0);
  });

  it('still hands them to the Talk screen, oldest first', async () => {
    await db.messages.bulkPut(rows);
    expect((await messagesRepo.talkTurns()).map((row) => row.id)).toEqual(['t1', 't2', 't3', 't4']);
  });
});
