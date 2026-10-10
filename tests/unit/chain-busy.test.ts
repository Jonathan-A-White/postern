// chainBusy.ts (mw-rch8bu): what counts as a busy WhatsOnChain, the waits, and the plain words for a relayed refusal.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUSY_RETRY_DELAYS_MS, busyOf, plainMessage, providerRefusal, retryWhenBusy, setBusyRetryDelaysMs } from '../../src/services/chainBusy';

afterEach(() => {
  setBusyRetryDelaysMs(undefined);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('busyOf', () => {
  it('knows a relayed 429 and 5xx, the library words for them, and an unreachable fetch', () => {
    expect(busyOf(new Error('WhatsOnChain said 429: <html>'))).toMatchObject({ kind: 'rate-limited', status: 429, body: '<html>' });
    expect(busyOf(new Error('WhatsOnChain said 503'))).toMatchObject({ kind: 'trouble', status: 503 });
    expect(busyOf(new Error('WhatsOnChain rate-limited the request (429) after retries'))).toMatchObject({ kind: 'rate-limited' });
    expect(busyOf(new Error('Could not reach WhatsOnChain after 3 tries (offline, or rate-limited)'))).toMatchObject({ kind: 'unreachable' });
  });

  it('does not take a 4xx refusal or any other error for busy', () => {
    expect(busyOf(new Error('WhatsOnChain said 400: bad tx'))).toBeNull();
    expect(busyOf(new Error('the network rejected it'))).toBeNull();
    expect(busyOf('WhatsOnChain said 429')).toBeNull();
  });
});

describe('retryWhenBusy', () => {
  it('waits 5, 10 and 15 seconds: four tries over thirty seconds', async () => {
    expect(BUSY_RETRY_DELAYS_MS).toEqual([5000, 10000, 15000]);
    vi.useFakeTimers();
    const call = vi.fn().mockRejectedValue(new Error('WhatsOnChain said 429: x'));
    const onBusy = vi.fn();
    const outcome = retryWhenBusy(call, onBusy).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await outcome).toBe('WhatsOnChain said 429: x');
    expect(call).toHaveBeenCalledTimes(4);
    expect(onBusy).toHaveBeenCalledTimes(3);
  });

  it('stops at once for an error that is not busy, or one the caller will not retry', async () => {
    setBusyRetryDelaysMs([1, 1, 1]);
    const plain = vi.fn().mockRejectedValue(new Error('bad'));
    await expect(retryWhenBusy(plain)).rejects.toThrow('bad');
    expect(plain).toHaveBeenCalledTimes(1);
    const trouble = vi.fn().mockRejectedValue(new Error('WhatsOnChain said 503'));
    await expect(retryWhenBusy(trouble, undefined, (busy) => busy.kind === 'rate-limited')).rejects.toThrow('503');
    expect(trouble).toHaveBeenCalledTimes(1);
  });
});

describe('plainMessage', () => {
  it('keeps a short plain reason and turns a page, or a 429, into one line with the body on the console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(plainMessage(new Error('WhatsOnChain said 500: node rejected the transaction'))).toBe('WhatsOnChain said 500: node rejected the transaction');
    expect(warn).not.toHaveBeenCalled();
    expect(plainMessage(new Error('WhatsOnChain said 429: <html>nginx</html>'))).toBe('WhatsOnChain is rate-limiting us. Try again in a minute.');
    expect(plainMessage(new Error('WhatsOnChain said 502: <html>Bad Gateway</html>'))).toBe('WhatsOnChain answered 502. Try again in a minute.');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(providerRefusal('nothing here')).toBeNull();
  });
});
