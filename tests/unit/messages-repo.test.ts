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
});
