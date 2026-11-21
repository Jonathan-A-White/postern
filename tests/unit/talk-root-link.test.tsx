// A root= link that names a Talk turn or a call record (mw-ev7oyy.63): such a row is no channel's post
// (docs/protocol.md §20, §21), so there is no reply thread to draw. The screen shows the channel, never
// the empty "That post is not on this phone" state.
import '@testing-library/react/dont-cleanup-after-each';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { db, type MessageRow } from '../../src/data/db';
import { messagesRepo } from '../../src/data/repositories';

let sequence = 0;
function row(over: Partial<MessageRow> = {}): MessageRow {
  sequence += 1;
  const txid = `${'cd'.repeat(31)}${String(sequence).padStart(2, '0')}`;
  return {
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq: sequence,
    class: 'message',
    to: '02'.padEnd(66, '0'),
    from: '03'.padEnd(66, '0'),
    ts: 1_000 + sequence,
    ciphertext: '',
    plaintext: `Message ${sequence}`,
    direction: 'received',
    read: true,
    ...over,
  };
}

beforeEach(async () => {
  cleanup();
  sequence = 0;
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear()]);
  window.history.replaceState(null, '', '/?v=talk');
});

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

describe('a root= link that names a Talk turn or a call record', () => {
  for (const cls of ['talk', 'call'] as const) {
    it(`shows the channel, not the empty state, for a ${cls} row`, async () => {
      const post = row({ plaintext: 'A post in Factory' });
      const turn = row({ class: cls, plaintext: 'a turn spoken on the line' });
      await messagesRepo.put(post);
      await messagesRepo.put(turn);

      render(<TalkScreen thread="general" root={turn.txid} />);

      // The channel's own post is drawn, and the empty state is not.
      expect(await screen.findByText('A post in Factory')).toBeInTheDocument();
      expect(screen.queryByText('That post is not on this phone')).not.toBeInTheDocument();
      await waitFor(() => expect(screen.queryByPlaceholderText('Reply…')).not.toBeInTheDocument());
    });
  }

  it('still opens the reply thread for a root that is a post', async () => {
    const post = row({ plaintext: 'A post in Factory' });
    await messagesRepo.put(post);
    render(<TalkScreen thread="general" root={post.txid} />);
    expect(await screen.findByPlaceholderText('Reply…')).toBeInTheDocument();
  });
});
