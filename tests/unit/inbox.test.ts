import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrivateKey, Utils } from '@bsv/sdk';
import { db } from '../../src/data/db';
import { messagesRepo, settingsRepo } from '../../src/data/repositories';
import { encryptMessage } from '../../src/services/messages';
import { decryptPendingMessages, syncMessages } from '../../src/services/inbox';

const ME = PrivateKey.fromHex('44'.repeat(32));
const SENDER = PrivateKey.fromHex('55'.repeat(32));
const STRANGER = PrivateKey.fromHex('66'.repeat(32));

function meKeyBytes(): Uint8Array {
  return new Uint8Array(Utils.toArray(ME.toHex(), 'hex'));
}

function apiResponse(records: unknown[], next: number): Response {
  return new Response(JSON.stringify({ records, next }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function recordFor(seq: number, payload: unknown) {
  return { seq, txid: seq.toString(16).padStart(64, '0'), vout: 0, payload };
}

describe('syncMessages', () => {
  beforeEach(async () => {
    await db.messages.clear();
    await db.settings.clear();
  });

  it('keeps a message addressed to me, decrypted with the unlocked key', async () => {
    const payload = encryptMessage({
      text: 'meet at the usual place',
      class: 'message',
      senderPrivateKeyHex: SENDER.toHex(),
      recipientPublicKeyHex: ME.toPublicKey().toString(),
    });
    const fetchImpl = vi.fn(async () => apiResponse([recordFor(1, payload)], 1));

    await syncMessages({ publicKeyHex: ME.toPublicKey().toString(), unlockedKey: meKeyBytes(), fetchImpl });

    const rows = await messagesRepo.getAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].plaintext).toBe('meet at the usual place');
    expect(rows[0].direction).toBe('received');
  });

  it('does not keep a record addressed to someone else', async () => {
    const payload = encryptMessage({
      text: 'not for me',
      class: 'message',
      senderPrivateKeyHex: SENDER.toHex(),
      recipientPublicKeyHex: STRANGER.toPublicKey().toString(),
    });
    const fetchImpl = vi.fn(async () => apiResponse([recordFor(1, payload)], 1));

    await syncMessages({ publicKeyHex: ME.toPublicKey().toString(), unlockedKey: meKeyBytes(), fetchImpl });

    expect(await messagesRepo.getAll()).toHaveLength(0);
  });

  it('keeps a message I sent, marked with direction sent', async () => {
    const payload = encryptMessage({
      text: 'from me to the mayor',
      class: 'message',
      senderPrivateKeyHex: ME.toHex(),
      recipientPublicKeyHex: STRANGER.toPublicKey().toString(),
    });
    const fetchImpl = vi.fn(async () => apiResponse([recordFor(1, payload)], 1));

    await syncMessages({ publicKeyHex: ME.toPublicKey().toString(), fetchImpl });

    const rows = await messagesRepo.getAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe('sent');
    expect(rows[0].plaintext).toBeUndefined();
  });

  it('advances the cursor so a second sync passes the new since and fetches nothing new', async () => {
    const payload = encryptMessage({
      text: 'first',
      class: 'message',
      senderPrivateKeyHex: SENDER.toHex(),
      recipientPublicKeyHex: ME.toPublicKey().toString(),
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(apiResponse([recordFor(1, payload)], 1))
      .mockResolvedValueOnce(apiResponse([], 1));

    await syncMessages({ publicKeyHex: ME.toPublicKey().toString(), unlockedKey: meKeyBytes(), fetchImpl });
    await syncMessages({ publicKeyHex: ME.toPublicKey().toString(), unlockedKey: meKeyBytes(), fetchImpl });

    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/api/messages?since=0');
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/api/messages?since=1');
    expect(await messagesRepo.getAll()).toHaveLength(1);
  });

  it('rejects and stores nothing when the fetch fails, leaving stored messages as they were', async () => {
    await messagesRepo.put({
      id: 'stored:0',
      txid: 'stored',
      vout: 0,
      seq: 1,
      class: 'message',
      to: ME.toPublicKey().toString(),
      from: SENDER.toPublicKey().toString(),
      ts: 1758700000,
      ciphertext: 'ct',
      plaintext: 'already decrypted before going offline',
      direction: 'received',
      read: false,
    });
    const fetchImpl = vi.fn(async () => new Response('', { status: 502 }));

    await expect(
      syncMessages({ publicKeyHex: ME.toPublicKey().toString(), fetchImpl }),
    ).rejects.toThrow();

    const rows = await messagesRepo.getAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].plaintext).toBe('already decrypted before going offline');
  });

  it('marks a record addressed to me that fails to decrypt as unreadable, not dropped', async () => {
    const payload = encryptMessage({
      text: 'for someone else, not me',
      class: 'message',
      senderPrivateKeyHex: SENDER.toHex(),
      recipientPublicKeyHex: STRANGER.toPublicKey().toString(),
    });
    // Claims to be addressed to me, but was actually encrypted for STRANGER, so my
    // key cannot decrypt the ciphertext.
    const forged = { ...payload, to: ME.toPublicKey().toString() };
    const fetchImpl = vi.fn(async () => apiResponse([recordFor(1, forged)], 1));

    await syncMessages({ publicKeyHex: ME.toPublicKey().toString(), unlockedKey: meKeyBytes(), fetchImpl });

    const rows = await messagesRepo.getAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].plaintext).toBeUndefined();
    expect(rows[0].decryptFailed).toBe(true);
  });

  it('leaves a message pending (not decrypted) when synced while the key is locked', async () => {
    const payload = encryptMessage({
      text: 'meet at the usual place',
      class: 'message',
      senderPrivateKeyHex: SENDER.toHex(),
      recipientPublicKeyHex: ME.toPublicKey().toString(),
    });
    const fetchImpl = vi.fn(async () => apiResponse([recordFor(1, payload)], 1));

    await syncMessages({ publicKeyHex: ME.toPublicKey().toString(), fetchImpl });

    const rows = await messagesRepo.getAll();
    expect(rows[0].plaintext).toBeUndefined();
    expect(rows[0].decryptFailed).toBeFalsy();
  });
});

describe('decryptPendingMessages', () => {
  beforeEach(async () => {
    await db.messages.clear();
    await db.settings.clear();
  });

  it('decrypts a message that was stored while the key was locked', async () => {
    const payload = encryptMessage({
      text: 'now readable',
      class: 'message',
      senderPrivateKeyHex: SENDER.toHex(),
      recipientPublicKeyHex: ME.toPublicKey().toString(),
    });
    const fetchImpl = vi.fn(async () => apiResponse([recordFor(1, payload)], 1));
    await syncMessages({ publicKeyHex: ME.toPublicKey().toString(), fetchImpl });

    await decryptPendingMessages(meKeyBytes());

    const rows = await messagesRepo.getAll();
    expect(rows[0].plaintext).toBe('now readable');
  });
});

// settingsRepo is exercised indirectly above (the cursor), but confirm the setting
// key it uses so a future change to it is a deliberate one.
describe('messages cursor storage', () => {
  it('is kept under the messages-cursor setting', async () => {
    await db.messages.clear();
    await db.settings.clear();
    const payload = encryptMessage({
      text: 'x',
      class: 'message',
      senderPrivateKeyHex: SENDER.toHex(),
      recipientPublicKeyHex: ME.toPublicKey().toString(),
    });
    const fetchImpl = vi.fn(async () => apiResponse([recordFor(5, payload)], 5));
    await syncMessages({ publicKeyHex: ME.toPublicKey().toString(), fetchImpl });
    expect(await settingsRepo.get('messages-cursor')).toBe(5);
  });
});
