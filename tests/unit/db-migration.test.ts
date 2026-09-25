import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';
import { db } from '../../src/data/db';

describe('PosternDB migration to v3 (messages)', () => {
  it('adding the messages table does not lose an existing vault row', async () => {
    db.close();
    await Dexie.delete('PosternDB');

    // Simulates a phone that already has a v2 database (settings + vault, no
    // messages table) — the schema this app shipped with before this story.
    const legacy = new Dexie('PosternDB');
    legacy.version(1).stores({ settings: 'key' });
    legacy.version(2).stores({ settings: 'key', vault: 'id' });
    await legacy.open();
    await legacy.table('vault').put({
      id: 'default',
      mode: 'phrase',
      ciphertext: new Uint8Array([1, 2, 3]).buffer,
      iv: new Uint8Array([4, 5, 6]),
      salt: new Uint8Array([7, 8]),
      publicKeyHex: '02'.padEnd(66, '1'),
    });
    legacy.close();

    await db.open();

    const vault = await db.vault.get('default');
    expect(vault?.mode).toBe('phrase');
    expect(vault?.publicKeyHex).toBe('02'.padEnd(66, '1'));
    expect(await db.messages.count()).toBe(0);
  });
});

describe('PosternDB migration to v4 (snapshot)', () => {
  it('adding the snapshot table does not lose an existing messages row', async () => {
    db.close();
    await Dexie.delete('PosternDB');

    // Simulates a phone that already has a v3 database (no snapshot table) —
    // the schema this app shipped with before this story.
    const legacy = new Dexie('PosternDB');
    legacy.version(1).stores({ settings: 'key' });
    legacy.version(2).stores({ settings: 'key', vault: 'id' });
    legacy.version(3).stores({ settings: 'key', vault: 'id', messages: 'id, seq, ts, read' });
    await legacy.open();
    await legacy.table('messages').put({
      id: 'a'.repeat(64) + ':0',
      txid: 'a'.repeat(64),
      vout: 0,
      seq: 1,
      class: 'message',
      to: '02'.padEnd(66, '1'),
      from: '03'.padEnd(66, '2'),
      ts: 1758700800,
      ciphertext: 'abcd',
      direction: 'received',
      read: false,
    });
    legacy.close();

    await db.open();

    const message = await db.messages.get('a'.repeat(64) + ':0');
    expect(message?.class).toBe('message');
    expect(await db.snapshot.count()).toBe(0);
  });
});
