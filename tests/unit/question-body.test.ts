import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/db';
import { messagesRepo } from '../../src/data/repositories';
import { resolveQuestionBody } from '../../src/projects/questionBody';
import { encodeQuestion } from '../../src/services/questions';
import type { SnapshotNeedsYou } from '../../src/services/questions';

const NEEDS_YOU_ITEM: SnapshotNeedsYou = {
  id: 'mw-epic.1',
  title: 'Ship now or wait?',
  asked_at: '2026-09-24T08:00:00Z',
  recommended: 'ship',
  options: ['ship', 'wait'],
};

describe('resolveQuestionBody', () => {
  beforeEach(async () => {
    await db.messages.clear();
  });

  it('falls back to the snapshot fields when no matching message is synced', async () => {
    const body = await resolveQuestionBody(NEEDS_YOU_ITEM);
    expect(body).toEqual({
      bead: 'mw-epic.1',
      q: 'Ship now or wait?',
      rec: 'ship',
      options: ['ship', 'wait'],
    });
  });

  it('prefers the fuller text of a synced decision-needed message naming the same bead', async () => {
    await messagesRepo.put({
      id: 'a'.repeat(64) + ':0',
      txid: 'a'.repeat(64),
      vout: 0,
      seq: 1,
      class: 'decision-needed',
      to: '02'.padEnd(66, '1'),
      from: '03'.padEnd(66, '2'),
      ts: 1758700000,
      ciphertext: 'ct',
      plaintext: encodeQuestion({
        bead: 'mw-epic.1',
        q: 'Ship the walking skeleton now, or wait for WireGuard?',
        rec: 'ship',
        options: ['ship', 'wait'],
      }),
      direction: 'received',
      read: false,
    });

    const body = await resolveQuestionBody(NEEDS_YOU_ITEM);
    expect(body.q).toBe('Ship the walking skeleton now, or wait for WireGuard?');
  });

  it('ignores a decision-needed message naming a different bead', async () => {
    await messagesRepo.put({
      id: 'a'.repeat(64) + ':0',
      txid: 'a'.repeat(64),
      vout: 0,
      seq: 1,
      class: 'decision-needed',
      to: '02'.padEnd(66, '1'),
      from: '03'.padEnd(66, '2'),
      ts: 1758700000,
      ciphertext: 'ct',
      plaintext: encodeQuestion({ bead: 'mw-other.9', q: 'Different question?', rec: 'a', options: ['a', 'b'] }),
      direction: 'received',
      read: false,
    });

    const body = await resolveQuestionBody(NEEDS_YOU_ITEM);
    expect(body.q).toBe('Ship now or wait?');
  });
});
