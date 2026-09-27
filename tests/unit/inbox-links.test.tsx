// tests/unit/inbox-links.test.tsx — mw-tfne4.31: every Inbox row is tappable and
// opens the place he can reply: threadHref for a row whose thread names a bead or
// topic, the general thread for a plain message, and (unchanged) the inline
// Question screen for a decision-needed row whose plaintext decodes to one.
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrivateKey } from '@bsv/sdk';
import { Inbox } from '../../src/inbox';
import { db } from '../../src/data/db';
import { vaultRepo, messagesRepo } from '../../src/data/repositories';
import { setKey, lock } from '../../src/services/keySession';
import { setMayorPublicKey } from '../../src/services/messages';
import { encodeQuestion } from '../../src/services/questions';
import { threadHref } from '../../src/services/threads';

const TEST_KEY = PrivateKey.fromHex('44'.repeat(32));
const MAYOR_KEY = PrivateKey.fromHex('99'.repeat(32));
const BEAD_ID = 'mw-inbox-links.1';

function fetchStub() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/challenge')) {
      return new Response(JSON.stringify({ nonce: 'a'.repeat(64) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/messages')) {
      return new Response(JSON.stringify({ records: [], next: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

beforeEach(async () => {
  await db.vault.clear();
  await db.settings.clear();
  await db.messages.clear();
  lock();
  vi.stubGlobal('fetch', fetchStub());
  await vaultRepo.save({
    mode: 'phrase',
    ciphertext: new Uint8Array([1]).buffer,
    iv: new Uint8Array(12),
    salt: new Uint8Array(16),
    prfFallbackReason: 'webauthn-unavailable',
    publicKeyHex: TEST_KEY.toPublicKey().toString(),
  });
  await setMayorPublicKey(MAYOR_KEY.toPublicKey().toString());
  setKey(new Uint8Array(32));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Inbox rows link to their thread (mw-tfne4.31 AC1)', () => {
  it('a received message with a bead thread renders as a link to threadHref({bead})', async () => {
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
      read: true,
      thread: `bead:${BEAD_ID}`,
    });

    render(<Inbox />);

    const link = await screen.findByRole('link', { name: /meet at the usual place/ });
    expect(link.getAttribute('href')).toBe(threadHref({ bead: BEAD_ID }));
  });

  it('a received message with a topic thread renders as a link to threadHref({topic})', async () => {
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
      read: true,
      thread: 'topic:launch plan',
    });

    render(<Inbox />);

    const link = await screen.findByRole('link', { name: /ready when you are/ });
    expect(link.getAttribute('href')).toBe(threadHref({ topic: 'launch plan' }));
  });

  it('a plain message with no thread renders as a link to the general thread', async () => {
    await messagesRepo.put({
      id: 'c'.repeat(64) + ':0',
      txid: 'c'.repeat(64),
      vout: 0,
      seq: 3,
      class: 'message',
      to: 'to',
      from: 'from',
      ts: 300,
      ciphertext: 'unused',
      plaintext: 'the general update',
      direction: 'received',
      read: true,
    });

    render(<Inbox />);

    const link = await screen.findByRole('link', { name: /the general update/ });
    expect(link.getAttribute('href')).toBe('?screen=thread');
  });

  it('a decision-needed message with a decodable question still opens the Question screen, not a link', async () => {
    const bodyText = encodeQuestion({ bead: BEAD_ID, q: 'Ship now?', rec: 'ship', options: ['ship', 'wait'] });
    await messagesRepo.put({
      id: 'd'.repeat(64) + ':0',
      txid: 'd'.repeat(64),
      vout: 0,
      seq: 4,
      class: 'decision-needed',
      to: 'to',
      from: 'from',
      ts: 400,
      ciphertext: 'unused',
      plaintext: bodyText,
      direction: 'received',
      read: true,
      thread: `bead:${BEAD_ID}`,
    });

    render(<Inbox />);

    const button = await screen.findByRole('button', { name: /Ship now\?/ });
    expect(screen.queryByRole('link', { name: /Ship now\?/ })).not.toBeInTheDocument();

    fireEvent.click(button);

    expect(await screen.findByText('Recommended: ship')).toBeInTheDocument();
  });
});

describe('Inbox marks unread rows visibly (mw-tfne4.35 AC1)', () => {
  it('an unread received row carries the unread marker and a distinct row style', async () => {
    await messagesRepo.put({
      id: 'e'.repeat(64) + ':0',
      txid: 'e'.repeat(64),
      vout: 0,
      seq: 5,
      class: 'message',
      to: 'to',
      from: 'from',
      ts: 500,
      ciphertext: 'unused',
      plaintext: 'a fresh message',
      direction: 'received',
      read: false,
    });

    render(<Inbox />);

    const link = await screen.findByRole('link', { name: /a fresh message/ });
    expect(within(link).getByTestId('unread-marker')).toBeInTheDocument();
    expect(link).toHaveClass('border-l-4');
  });

  it('a read received row carries no unread marker and no distinct row style', async () => {
    await messagesRepo.put({
      id: 'f'.repeat(64) + ':0',
      txid: 'f'.repeat(64),
      vout: 0,
      seq: 6,
      class: 'message',
      to: 'to',
      from: 'from',
      ts: 600,
      ciphertext: 'unused',
      plaintext: 'an old message',
      direction: 'received',
      read: true,
    });

    render(<Inbox />);

    const link = await screen.findByRole('link', { name: /an old message/ });
    expect(within(link).queryByTestId('unread-marker')).not.toBeInTheDocument();
    expect(link).not.toHaveClass('border-l-4');
  });

  it('a sent row carries no unread marker regardless of its read flag', async () => {
    await messagesRepo.put({
      id: 'a'.repeat(64) + ':1',
      txid: 'a'.repeat(64),
      vout: 1,
      seq: 7,
      class: 'message',
      to: 'to',
      from: 'from',
      ts: 700,
      ciphertext: 'unused',
      plaintext: 'my own outgoing message',
      direction: 'sent',
      read: false,
    });

    render(<Inbox />);

    const link = await screen.findByRole('link', { name: /my own outgoing message/ });
    expect(within(link).queryByTestId('unread-marker')).not.toBeInTheDocument();
    expect(link).not.toHaveClass('border-l-4');
  });
});
