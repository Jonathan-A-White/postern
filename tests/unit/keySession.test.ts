import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getKey, setKey, lock, SESSION_MINUTES } from '../../src/services/keySession';
import { db } from '../../src/data/db';

const KEY = new Uint8Array([1, 2, 3, 4]);
const SESSION_MS = SESSION_MINUTES * 60 * 1000;

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('keySession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lock();
    setHidden(false);
  });

  afterEach(() => {
    lock();
    setHidden(false);
    vi.useRealTimers();
  });

  it('returns null before any key is set', () => {
    expect(getKey()).toBeNull();
  });

  it('returns the key that was set', () => {
    setKey(KEY);
    expect(getKey()).toEqual(KEY);
  });

  it('does not expire the key before the session window elapses', () => {
    setKey(KEY);
    vi.advanceTimersByTime(SESSION_MS - 1);
    expect(getKey()).toEqual(KEY);
  });

  it('expires the key once the session window elapses since last use', () => {
    setKey(KEY);
    vi.advanceTimersByTime(SESSION_MS + 1);
    expect(getKey()).toBeNull();
  });

  it('refreshes the expiry on every getKey call', () => {
    setKey(KEY);
    vi.advanceTimersByTime(SESSION_MS - 1);
    expect(getKey()).toEqual(KEY);
    vi.advanceTimersByTime(SESSION_MS - 1);
    expect(getKey()).toEqual(KEY);
  });

  it('lock clears the key immediately', () => {
    setKey(KEY);
    lock();
    expect(getKey()).toBeNull();
  });

  it('never writes the key to localStorage or sessionStorage', () => {
    setKey(KEY);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('never writes the key to Dexie', async () => {
    vi.useRealTimers();
    setKey(KEY);
    expect(await db.vault.toArray()).toEqual([]);
    expect(await db.settings.toArray()).toEqual([]);
  });

  it('starts with no session on a fresh module instance, as a fresh page load would', async () => {
    setKey(KEY);
    vi.resetModules();
    const fresh = await import('../../src/services/keySession');
    expect(fresh.getKey()).toBeNull();
  });

  it('keeps the key when the app is hidden for less than the session window', () => {
    setKey(KEY);
    setHidden(true);
    vi.advanceTimersByTime(SESSION_MS - 1);
    setHidden(false);
    expect(getKey()).toEqual(KEY);
  });

  it('clears the key when the app returns to the foreground after being hidden past the session window', () => {
    setKey(KEY);
    setHidden(true);
    vi.advanceTimersByTime(SESSION_MS + 1);
    setHidden(false);
    expect(getKey()).toBeNull();
  });
});
