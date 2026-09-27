// tests/unit/threads-screen.test.tsx — mw-tfne4.36 AC2: a thread's own row
// stops showing an unread count once that thread has been marked read, while
// another thread's row is untouched. Rows are seeded straight into Dexie, the
// same pattern tests/unit/thread-screen.test.tsx uses.
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { PrivateKey } from '@bsv/sdk';
import { ThreadsScreen } from '../../src/threads/ThreadsScreen';
import { db } from '../../src/data/db';
import { vaultRepo, messagesRepo } from '../../src/data/repositories';
import { setKey, lock } from '../../src/services/keySession';

const TEST_KEY = PrivateKey.fromHex('66'.repeat(32));

beforeEach(async () => {
  await db.vault.clear();
  await db.settings.clear();
  await db.messages.clear();
  lock();
  await vaultRepo.save({
    mode: 'phrase',
    ciphertext: new Uint8Array([1]).buffer,
    iv: new Uint8Array(12),
    salt: new Uint8Array(16),
    prfFallbackReason: 'webauthn-unavailable',
    publicKeyHex: TEST_KEY.toPublicKey().toString(),
  });
  setKey(new Uint8Array(32));
});

describe('ThreadsScreen: per-thread unread count (mw-tfne4.36 AC2)', () => {
  it("drops a thread's own unread count once marked read, leaving another thread's count unchanged", async () => {
    await messagesRepo.put({
      id: 'a'.repeat(64) + ':0',
      txid: 'a'.repeat(64),
      vout: 0,
      seq: 1,
      class: 'message',
      to: 'to',
      from: 'from',
      ts: 100,
      ciphertext: 'unused',
      plaintext: 'meet at the usual place',
      direction: 'received',
      read: false,
      thread: 'bead:mw-threads-screen.1',
    });
    await messagesRepo.put({
      id: 'b'.repeat(64) + ':0',
      txid: 'b'.repeat(64),
      vout: 0,
      seq: 2,
      class: 'message',
      to: 'to',
      from: 'from',
      ts: 200,
      ciphertext: 'unused',
      plaintext: 'ready when you are',
      direction: 'received',
      read: false,
      thread: 'topic:launch plan',
    });

    const { unmount } = render(<ThreadsScreen />);
    const rows = await screen.findAllByTestId('thread-row');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(within(row).getByText('1 unread')).toBeInTheDocument();
    }
    unmount();

    await messagesRepo.markThreadRead('bead:mw-threads-screen.1');

    render(<ThreadsScreen />);
    const refreshedRows = await screen.findAllByTestId('thread-row');
    expect(refreshedRows).toHaveLength(2);
    const beadRow = refreshedRows.find((row) => within(row).queryByText('mw-threads-screen.1'));
    const topicRow = refreshedRows.find((row) => within(row).queryByText('launch plan'));
    if (!beadRow || !topicRow) throw new Error('expected both thread rows to be present');
    expect(within(beadRow).queryByText('1 unread')).not.toBeInTheDocument();
    expect(within(topicRow).getByText('1 unread')).toBeInTheDocument();
  });
});
