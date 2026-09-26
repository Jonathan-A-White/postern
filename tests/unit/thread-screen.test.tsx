// tests/unit/thread-screen.test.tsx — mw-hy6f4.1: a received class `message`
// row with Markdown-shaped plaintext renders formatted, while a sent message
// and a decision-needed question still render exactly as today. Rows are
// seeded straight into Dexie (already "decrypted") rather than going through
// the encrypt/decrypt/sync machinery threads.steps.tsx exercises.
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { PrivateKey } from '@bsv/sdk';
import { ThreadScreen } from '../../src/threads/ThreadScreen';
import { db } from '../../src/data/db';
import { vaultRepo, messagesRepo } from '../../src/data/repositories';
import { setKey, lock } from '../../src/services/keySession';
import { encodeQuestion } from '../../src/services/questions';

const TEST_KEY = PrivateKey.fromHex('55'.repeat(32));
const BEAD_ID = 'mw-thread-screen.1';

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

describe('ThreadScreen: message rendering (AC3)', () => {
  it('formats a received message, but shows a sent message and a decision plain', async () => {
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
      plaintext: '## Heading\n\n- one\n- two',
      direction: 'received',
      read: true,
      thread: `bead:${BEAD_ID}`,
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
      direction: 'sent',
      decryptFailed: true,
      read: true,
      thread: `bead:${BEAD_ID}`,
    });
    await messagesRepo.put({
      id: 'c'.repeat(64) + ':0',
      txid: 'c'.repeat(64),
      vout: 0,
      seq: 3,
      class: 'decision-needed',
      to: 'to',
      from: 'from',
      ts: 300,
      ciphertext: 'unused',
      plaintext: encodeQuestion({ bead: BEAD_ID, q: 'Ship **now**?', rec: 'ship', options: ['ship', 'wait'] }),
      direction: 'received',
      read: true,
      thread: `bead:${BEAD_ID}`,
    });

    render(<ThreadScreen threadRef={{ bead: BEAD_ID }} />);

    const rows = await screen.findAllByTestId('thread-message');
    expect(rows).toHaveLength(3);
    const [formattedRow, sentRow, decisionRow] = rows;

    expect(within(formattedRow).getByRole('heading', { level: 2, name: 'Heading' })).toBeInTheDocument();
    expect(within(formattedRow).getAllByRole('listitem')).toHaveLength(2);

    expect(within(sentRow).getByText('Sent message.')).toBeInTheDocument();

    expect(within(decisionRow).getByText('Ship **now**?')).toBeInTheDocument();
    expect(within(decisionRow).queryByRole('heading', { name: 'now' })).not.toBeInTheDocument();
  });
});
