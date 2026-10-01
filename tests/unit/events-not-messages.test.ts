// An events record (docs/protocol.md §22) is never a message row and never a bubble (mw-jrx0s.22):
// whichever road brings one, and whatever an older build once stored.
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type MessageRow } from '../../src/data/db';
import { messagesRepo } from '../../src/data/repositories';

function row(id: string, cls: MessageRow['class'], ts: number, thread?: string): MessageRow {
  return { id, txid: id, vout: 0, seq: ts, class: cls, to: 'me', from: 'mayor', ts, ciphertext: 'ct', plaintext: '{"from":1,"to":1,"events":[]}', direction: 'received', read: false, thread };
}

beforeEach(async () => {
  await db.messages.clear();
});

describe('a message row made from an events record', () => {
  it('is refused by the repository', async () => {
    await messagesRepo.put(row('aa', 'events', 1));
    expect(await db.messages.count()).toBe(0);
  });

  it('is left out of every list, thread and unread count, even if a stale build stored it', async () => {
    await db.messages.bulkPut([row('aa', 'events', 1), row('bb', 'events', 2, 'mw-x.1'), row('cc', 'message', 3)]);
    expect((await messagesRepo.getAll()).map((r) => r.id)).toEqual(['cc']);
    expect((await messagesRepo.getAllOldestFirst()).map((r) => r.id)).toEqual(['cc']);
    expect(await messagesRepo.inThread(undefined)).toHaveLength(1);
    expect(await messagesRepo.inThread('mw-x.1')).toEqual([]);
    expect(await messagesRepo.countUnread()).toBe(1);
  });

  it('is removed when the app opens, and the messages stay', async () => {
    await db.messages.bulkPut([row('aa', 'events', 1), row('cc', 'message', 3)]);
    db.close();
    await db.open();
    expect((await db.messages.toArray()).map((r) => r.id)).toEqual(['cc']);
  });
});
