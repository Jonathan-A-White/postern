// tests/unit/inbox-routing.test.tsx — mw-tfne4.31 AC2: following an Inbox row's
// link, the same way tests/unit/app-routing.test.tsx (mw-tfne4.28/.29) proves a
// `?screen=` link click is a route change, not a page load, renders the Thread
// screen with that message listed and the reply control present, and the shared
// key session (mw-tfne4.23) is never reset.
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { PrivateKey } from '@bsv/sdk';
import { App } from '../../src/App';
import { db } from '../../src/data/db';
import { vaultRepo, messagesRepo } from '../../src/data/repositories';
import { getKey, setKey, lock } from '../../src/services/keySession';
import { setMayorPublicKey } from '../../src/services/messages';

const TEST_KEY = PrivateKey.fromHex('44'.repeat(32));
const MAYOR_KEY = PrivateKey.fromHex('99'.repeat(32));
const BEAD_ID = 'mw-inbox-routing.1';

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

describe('following an Inbox row link opens its thread with the key still unlocked (mw-tfne4.31 AC2)', () => {
  afterEach(async () => {
    cleanup();
    lock();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
    await db.vault.clear();
    await db.messages.clear();
    await db.settings.clear();
  });

  it('renders ThreadScreen with the message listed and the reply control present', async () => {
    await vaultRepo.save({
      mode: 'phrase',
      ciphertext: new Uint8Array([1]).buffer,
      iv: new Uint8Array(12),
      salt: new Uint8Array(16),
      prfFallbackReason: 'webauthn-unavailable',
      publicKeyHex: TEST_KEY.toPublicKey().toString(),
    });
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
    await setMayorPublicKey(MAYOR_KEY.toPublicKey().toString());
    vi.stubGlobal('fetch', fetchStub());

    const masterKey = new Uint8Array(32).fill(7);
    setKey(masterKey);
    window.history.pushState({}, '', '?screen=inbox');
    render(<App />);

    const link = await screen.findByRole('link', { name: /meet at the usual place/ });
    const clickDefaultRan = fireEvent.click(link);

    expect(clickDefaultRan).toBe(false); // the anchor's default navigation was prevented
    expect(window.location.search).toBe(`?screen=thread&thread=${encodeURIComponent(`bead:${BEAD_ID}`)}`);
    expect(getKey()).toEqual(masterKey); // still shared: no page load reset the module session

    expect(await screen.findByTestId('thread-message')).toHaveTextContent('meet at the usual place');
    expect(screen.getByLabelText('Reply')).toBeInTheDocument();
  });

  it('tapping an unread row still marks it read and opens its thread (mw-tfne4.35 AC2)', async () => {
    await vaultRepo.save({
      mode: 'phrase',
      ciphertext: new Uint8Array([1]).buffer,
      iv: new Uint8Array(12),
      salt: new Uint8Array(16),
      prfFallbackReason: 'webauthn-unavailable',
      publicKeyHex: TEST_KEY.toPublicKey().toString(),
    });
    const messageId = 'a'.repeat(64) + ':0';
    await messagesRepo.put({
      id: messageId,
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
      thread: `bead:${BEAD_ID}`,
    });
    await setMayorPublicKey(MAYOR_KEY.toPublicKey().toString());
    vi.stubGlobal('fetch', fetchStub());

    const masterKey = new Uint8Array(32).fill(7);
    setKey(masterKey);
    window.history.pushState({}, '', '?screen=inbox');
    render(<App />);

    const link = await screen.findByRole('link', { name: /meet at the usual place/ });
    expect(within(link).getByTestId('unread-marker')).toBeInTheDocument();
    fireEvent.click(link);

    expect(window.location.search).toBe(`?screen=thread&thread=${encodeURIComponent(`bead:${BEAD_ID}`)}`);
    expect(await screen.findByTestId('thread-message')).toHaveTextContent('meet at the usual place');

    const stored = await messagesRepo.get(messageId);
    expect(stored?.read).toBe(true);
  });
});
