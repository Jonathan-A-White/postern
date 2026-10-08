// setVisibleInterval (mw-xhtcup.1): an interval that sleeps while the page is hidden and
// fires once on return, so the Later-tap drain and the presence poll do not tick all night.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setVisibleInterval } from '../../src/ui/visibleInterval';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('setVisibleInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('fires every interval while the page is visible', () => {
    const fn = vi.fn();
    const stop = setVisibleInterval(fn, 15_000);
    vi.advanceTimersByTime(45_000);
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
  });

  it('does not fire across a minute hidden, then fires exactly once on visible', () => {
    const fn = vi.fn();
    const stop = setVisibleInterval(fn, 15_000);
    setVisibility('hidden');
    vi.advanceTimersByTime(60_000);
    expect(fn).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
  });

  it('started while hidden stays quiet until the page is visible', () => {
    setVisibility('hidden');
    const fn = vi.fn();
    const stop = setVisibleInterval(fn, 15_000);
    vi.advanceTimersByTime(60_000);
    expect(fn).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stop() ends it: no ticks, no catch-up, and the listener is gone', () => {
    const fn = vi.fn();
    const remove = vi.spyOn(document, 'removeEventListener');
    const stop = setVisibleInterval(fn, 15_000);
    stop();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    vi.advanceTimersByTime(60_000);
    setVisibility('hidden');
    setVisibility('visible');
    expect(fn).not.toHaveBeenCalled();
    remove.mockRestore();
  });
});
