// plans/0021 decision 14 (the Governor, 2026-09-28: "passkey unlock once a
// day"): the unlocked key is shared by every screen for a day from unlocking,
// kept across relaunches by src/services/session.ts, and dropped at once by Lock.
// The persistence itself is tested in session.test.ts; here it is a stand-in.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const persisted: { key?: Uint8Array; expiresAt?: number } = {};

vi.mock('../../src/services/session', () => ({
  persistSession: vi.fn(async (key: Uint8Array, expiresAt: number) => {
    persisted.key = key;
    persisted.expiresAt = expiresAt;
    return true;
  }),
  restoreSession: vi.fn(async () => (persisted.key && persisted.expiresAt ? { key: persisted.key, expiresAt: persisted.expiresAt } : null)),
  clearSession: vi.fn(async () => {
    delete persisted.key;
    delete persisted.expiresAt;
  }),
}));

import { getKey, setKey, lock, resumeSession, onKeyChange, sessionExpiresAt, SESSION_MS, SESSION_HOURS } from '../../src/services/keySession';

const KEY = new Uint8Array([1, 2, 3, 4]);

describe('keySession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lock();
  });

  afterEach(() => {
    lock();
    vi.useRealTimers();
  });

  it('lasts a day', () => {
    expect(SESSION_HOURS).toBe(24);
    expect(SESSION_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('returns null before any key is set', () => {
    expect(getKey()).toBeNull();
  });

  it('returns the key that was set, and keeps it until the day is up', () => {
    setKey(KEY);
    vi.advanceTimersByTime(SESSION_MS - 1);
    expect(getKey()).toEqual(KEY);
    vi.advanceTimersByTime(2);
    expect(getKey()).toBeNull();
  });

  it('does not stretch the day when the key is used (a day from unlocking, not from last use)', () => {
    setKey(KEY);
    vi.advanceTimersByTime(SESSION_MS / 2);
    expect(getKey()).toEqual(KEY);
    vi.advanceTimersByTime(SESSION_MS / 2 + 1);
    expect(getKey()).toBeNull();
  });

  it('keeps the key while the app sits in the background', () => {
    setKey(KEY);
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(60 * 60 * 1000);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(getKey()).toEqual(KEY);
  });

  it('persists the key with its expiry, and Lock clears both', () => {
    setKey(KEY);
    expect(persisted.key).toEqual(KEY);
    expect(persisted.expiresAt).toBe(sessionExpiresAt());
    lock();
    expect(getKey()).toBeNull();
    expect(persisted.key).toBeUndefined();
  });

  it('resumes a session kept from earlier today, as a relaunch would', async () => {
    setKey(KEY);
    vi.resetModules();
    const fresh = await import('../../src/services/keySession');
    expect(fresh.getKey()).toBeNull();
    expect(await fresh.resumeSession()).toBe(true);
    expect(fresh.getKey()).toEqual(KEY);
  });

  it('tells listeners when the key comes and goes', async () => {
    const seen: boolean[] = [];
    const stop = onKeyChange(() => seen.push(getKey() !== null));
    setKey(KEY);
    lock();
    stop();
    setKey(KEY);
    expect(seen).toEqual([true, false]);
    expect(await resumeSession()).toBe(true);
  });

  it('never writes the key to localStorage or sessionStorage', () => {
    setKey(KEY);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
