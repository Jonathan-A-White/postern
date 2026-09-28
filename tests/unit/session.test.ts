// plans/0021 decision 14: the daily unlock's persisted half. The master key is
// stored only wrapped with a non-extractable device key; it comes back while the
// day lasts, never after, and Lock removes it.
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/db';
import { clearSession, persistSession, restoreSession } from '../../src/services/session';

const KEY = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1));

describe('session', () => {
  beforeEach(async () => {
    await db.session.clear();
  });

  it('never stores the key in the clear', async () => {
    expect(await persistSession(KEY, Date.now() + 60_000)).toBe(true);
    const row = await db.session.get('daily');
    expect(row).toBeDefined();
    const bytes = new Uint8Array(row!.ciphertext);
    expect(Array.from(bytes)).not.toEqual(Array.from(KEY));
    expect(row!.deviceKey.extractable).toBe(false);
  });

  it('gives the key back before it lapses', async () => {
    const expiresAt = Date.now() + 60_000;
    expect(await persistSession(KEY, expiresAt)).toBe(true);
    expect(await restoreSession()).toEqual({ key: KEY, expiresAt });
  });

  it('gives nothing back once it has lapsed, and forgets it', async () => {
    expect(await persistSession(KEY, Date.now() + 1_000)).toBe(true);
    expect(await restoreSession(Date.now() + 2_000)).toBeNull();
    expect(await db.session.get('daily')).toBeUndefined();
  });

  it('forgets it on clear', async () => {
    await persistSession(KEY, Date.now() + 60_000);
    await clearSession();
    expect(await restoreSession()).toBeNull();
  });
});
