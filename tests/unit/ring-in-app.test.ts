// A ring the phone read off the chain rings in the app (docs/protocol.md §21): a notification
// through the registered service worker when he has allowed them, else a banner and a vibration.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageRow } from '../../src/data/db';
import { encodeCall } from '../../src/services/call';
import { RING_VIBRATE } from '../../src/push/classOptions';
import { dismissIncomingRing, freshRings, getIncomingRing, ringInApp } from '../../src/services/ringIn';

const row = (over: Partial<MessageRow>): MessageRow => ({
  id: 'x:0', txid: 'x', vout: 0, seq: 1, class: 'call', to: 'phone', from: 'mayor', ts: 1_000, ciphertext: 'ct',
  plaintext: encodeCall({ role: 'ring', text: 'Back now', at: 1_000 }), direction: 'received', read: true, thread: 'call', ...over,
});

afterEach(() => {
  dismissIncomingRing();
  vi.unstubAllGlobals();
});

describe('which new rows ring', () => {
  it('rings for a received ring a few minutes old, with its reason', () => {
    expect(freshRings([row({ txid: 'a' })], 1_000 + 60)).toEqual([{ txid: 'a', reason: 'Back now' }]);
  });

  it('does not ring for an old ring, a request, a message, his own record or one it could not read', () => {
    const nowSeconds = 1_000 + 3_600;
    const rows = [
      row({ txid: 'old' }),
      row({ txid: 'req', plaintext: encodeCall({ role: 'request', text: 'Call me', at: nowSeconds }) }),
      row({ txid: 'msg', class: 'message', plaintext: 'hello', ts: nowSeconds }),
      row({ txid: 'mine', direction: 'sent', ts: nowSeconds, plaintext: encodeCall({ role: 'ring', text: 'x', at: nowSeconds }) }),
      row({ txid: 'locked', plaintext: undefined, ts: nowSeconds }),
    ];
    expect(freshRings(rows, nowSeconds)).toEqual([]);
  });
});

describe('ringing in the app', () => {
  it('shows the ring notification through the registered service worker when allowed', async () => {
    const showNotification = vi.fn(() => Promise.resolve());
    vi.stubGlobal('Notification', { permission: 'granted' });
    Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: () => Promise.resolve({ showNotification }) }, configurable: true });
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true });

    expect(await ringInApp({ txid: 'a'.repeat(64), reason: 'Back now' })).toBe('notification');
    expect(showNotification).toHaveBeenCalledTimes(1);
    const [title, options] = showNotification.mock.calls[0] as unknown as [string, { body: string; tag: string; data: { url: string } }];
    expect(title).toBe('The Mayor is calling');
    expect(options).toMatchObject({ body: 'Back now', tag: 'mayor-call', data: { url: `/?v=line&call=${'a'.repeat(64)}` } });
    expect(getIncomingRing()).toBeUndefined();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('raises a banner and vibrates when notifications are not allowed', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' });
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true });

    expect(await ringInApp({ txid: 'b'.repeat(64), reason: 'Back now' })).toBe('banner');
    expect(getIncomingRing()).toEqual({ txid: 'b'.repeat(64), reason: 'Back now' });
    expect(vibrate).toHaveBeenCalledWith(RING_VIBRATE);
    dismissIncomingRing();
    expect(getIncomingRing()).toBeUndefined();
  });

  it('falls back to the banner when the service worker is not registered or will not show it', async () => {
    vi.stubGlobal('Notification', { permission: 'granted' });
    Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: () => Promise.resolve(undefined) }, configurable: true });
    expect(await ringInApp({ txid: 'c'.repeat(64), reason: '' })).toBe('banner');
    dismissIncomingRing();
    const showNotification = vi.fn(() => Promise.reject(new Error('no')));
    Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: () => Promise.resolve({ showNotification }) }, configurable: true });
    expect(await ringInApp({ txid: 'd'.repeat(64), reason: '' })).toBe('banner');
  });
});
