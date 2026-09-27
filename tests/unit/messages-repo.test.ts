import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/db';
import { messagesRepo } from '../../src/data/repositories';

function row(overrides: Partial<Parameters<typeof messagesRepo.put>[0]> = {}) {
  return {
    id: 'a'.repeat(64) + ':0',
    txid: 'a'.repeat(64),
    vout: 0,
    seq: 1,
    class: 'message' as const,
    to: '02'.padEnd(66, '1'),
    from: '03'.padEnd(66, '2'),
    ts: 1758700000,
    ciphertext: 'ct',
    direction: 'received' as const,
    read: false,
    ...overrides,
  };
}

describe('messagesRepo', () => {
  beforeEach(async () => {
    await db.messages.clear();
  });

  it('returns undefined for a message that was never stored', async () => {
    expect(await messagesRepo.get('missing')).toBeUndefined();
  });

  it('round-trips a stored message', async () => {
    await messagesRepo.put(row());
    const stored = await messagesRepo.get(row().id);
    expect(stored?.ciphertext).toBe('ct');
    expect(stored?.read).toBe(false);
  });

  it('lists messages newest first', async () => {
    await messagesRepo.put(row({ id: 'old:0', txid: 'old', ts: 100 }));
    await messagesRepo.put(row({ id: 'new:0', txid: 'new', ts: 200 }));
    const all = await messagesRepo.getAll();
    expect(all.map((r) => r.id)).toEqual(['new:0', 'old:0']);
  });

  it('marks a message read', async () => {
    await messagesRepo.put(row());
    await messagesRepo.markRead(row().id);
    expect((await messagesRepo.get(row().id))?.read).toBe(true);
  });

  it('counts unread received messages, ignoring sent and read ones', async () => {
    await messagesRepo.put(row({ id: 'unread:0', txid: 'unread', read: false }));
    await messagesRepo.put(row({ id: 'read:0', txid: 'read', read: true }));
    await messagesRepo.put(row({ id: 'sent:0', txid: 'sent', direction: 'sent', read: false }));
    expect(await messagesRepo.countUnread()).toBe(1);
  });

  it("marks a thread's unread received rows read, leaving other threads and sent rows untouched (mw-tfne4.36)", async () => {
    await messagesRepo.put(row({ id: 'a:0', txid: 'a', thread: 'bead:x', read: false }));
    await messagesRepo.put(row({ id: 'b:0', txid: 'b', thread: 'bead:x', direction: 'sent', read: false }));
    await messagesRepo.put(row({ id: 'c:0', txid: 'c', thread: 'topic:y', read: false }));
    await messagesRepo.put(row({ id: 'd:0', txid: 'd', thread: undefined, read: false }));

    await messagesRepo.markThreadRead('bead:x');

    expect((await messagesRepo.get('a:0'))?.read).toBe(true);
    expect((await messagesRepo.get('b:0'))?.read).toBe(false);
    expect((await messagesRepo.get('c:0'))?.read).toBe(false);
    expect((await messagesRepo.get('d:0'))?.read).toBe(false);
  });

  it('marks the general thread (no key) read without touching a named thread', async () => {
    await messagesRepo.put(row({ id: 'e:0', txid: 'e', thread: undefined, read: false }));
    await messagesRepo.put(row({ id: 'f:0', txid: 'f', thread: 'bead:x', read: false }));

    await messagesRepo.markThreadRead(undefined);

    expect((await messagesRepo.get('e:0'))?.read).toBe(true);
    expect((await messagesRepo.get('f:0'))?.read).toBe(false);
  });
});
