// mw-f758y.40: the Mayor's reply to a chain-borne post arrives direct (txid direct:<sha256>) and on chain
// (a bare txid, the same ciphertext, from, to and ts). It is one message; the direct row is the one kept.
import { describe, it, expect, beforeEach } from 'vitest';
import { PrivateKey } from '@bsv/sdk';
import { db, type MessageRow } from '../../src/data/db';
import { messagesRepo } from '../../src/data/repositories';
import { storeRecord } from '../../src/services/inbox';
import { encryptMessage, type MessagePayload } from '../../src/services/messages';
import { encodeThreadedMessage } from '../../src/services/threads';
import { mergeConversation } from '../../src/model/conversation';
import { twinsToDrop } from '../../src/model/twins';

const ME = PrivateKey.fromHex('44'.repeat(32));
const MAYOR = PrivateKey.fromHex('55'.repeat(32));
const ME_PUB = ME.toPublicKey().toString();
const KEY_HEX = ME.toHex();
const DIRECT = `direct:${'ab'.repeat(32)}`;
const CHAIN = 'cd'.repeat(32);

function reply(text: string, ts = 1_790_000_000): MessagePayload {
  return encryptMessage({ text, class: 'message', senderPrivateKeyHex: MAYOR.toHex(), recipientPublicKeyHex: ME_PUB, ts });
}

const direct = (payload: MessagePayload) => storeRecord({ seq: 7, txid: DIRECT, vout: 0, payload }, ME_PUB, KEY_HEX);
const onChain = (payload: MessagePayload) => storeRecord({ seq: -1, txid: CHAIN, vout: 0, payload }, ME_PUB, KEY_HEX);

describe('a message that arrives direct and on chain (mw-f758y.40)', () => {
  beforeEach(async () => {
    await db.messages.clear();
  });

  it('direct, then the chain copy: one row, the direct one, with its bead', async () => {
    const payload = reply(encodeThreadedMessage({ text: 'Landed.', thread: { bead: 'mw-x.1' } }));
    await direct(payload);
    expect(await onChain(payload)).toBeUndefined();

    const rows = await messagesRepo.getAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].txid).toBe(DIRECT);
    expect(rows[0].thread).toBe('bead:mw-x.1');
    expect(rows[0].plaintext).toContain('Landed.');
  });

  it('the chain copy first, then direct: the row takes the direct txid, its bead, and keeps its read state', async () => {
    const payload = reply(encodeThreadedMessage({ text: 'Landed.', thread: { bead: 'mw-x.1' } }));
    await onChain(payload);
    await messagesRepo.markRead(`${CHAIN}:0`);
    await direct(payload);

    const rows = await messagesRepo.getAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(`${DIRECT}:0`);
    expect(rows[0].thread).toBe('bead:mw-x.1');
    expect(rows[0].read).toBe(true);
    expect(await db.messages.count()).toBe(1);
  });

  it('two different messages with the same ts stay two rows', async () => {
    await direct(reply('First.'));
    await onChain(reply('Second.'));
    expect(await messagesRepo.getAll()).toHaveLength(2);
  });

  it('a chain copy stored again later does not come back', async () => {
    const payload = reply('Once.');
    await direct(payload);
    await onChain(payload);
    await onChain(payload);
    expect(await db.messages.count()).toBe(1);
  });

  it('the app opening removes a pair an older build kept twice, keeping the direct row', async () => {
    const payload = reply('Twice.');
    const base = { seq: 1, vout: 0, class: 'message', to: ME_PUB, from: MAYOR.toPublicKey().toString(), ts: payload.ts, ciphertext: payload.ct, plaintext: 'Twice.', direction: 'received', read: false } as const;
    await db.messages.bulkPut([
      { ...base, id: `${CHAIN}:0`, txid: CHAIN },
      { ...base, id: `${DIRECT}:0`, txid: DIRECT },
    ]);
    db.close();
    await db.open();
    expect((await db.messages.toArray()).map((row) => row.txid)).toEqual([DIRECT]);
  });
});

describe('the conversation shows a direct+chain pair once (mw-f758y.40)', () => {
  const base: Omit<MessageRow, 'id' | 'txid'> = { vout: 0, seq: 1, class: 'message', to: 't', from: 'f', ts: 1_790_000_000, ciphertext: 'same-ct', plaintext: 'Landed.', direction: 'received', read: false };
  const chainRow: MessageRow = { ...base, id: `${CHAIN}:0`, txid: CHAIN };
  const directRow: MessageRow = { ...base, id: `${DIRECT}:0`, txid: DIRECT };

  it('is one bubble, the direct one, in either order of arrival', () => {
    for (const rows of [[chainRow, directRow], [directRow, chainRow]]) {
      const items = mergeConversation(rows);
      expect(items).toHaveLength(1);
      expect(items[0].txid).toBe(DIRECT);
    }
  });

  it('keeps two messages that differ in ciphertext', () => {
    expect(mergeConversation([chainRow, { ...directRow, ciphertext: 'other-ct' }])).toHaveLength(2);
  });

  it('twinsToDrop names the chain copy and never a row without ciphertext', () => {
    expect(twinsToDrop([chainRow, directRow])).toEqual([chainRow]);
    const bare = { ...chainRow, ciphertext: '' };
    expect(twinsToDrop([bare, { ...directRow, ciphertext: '' }])).toEqual([]);
  });
});
