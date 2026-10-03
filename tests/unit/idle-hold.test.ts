// mw-1ox07o.1: what keeps the phone awake during a talk lets go after 5 minutes with nothing happening.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdWhileActive, TALK_IDLE_MS } from '../../src/services/idleHold';
import { holdAwake } from '../../src/services/wakeLock';
import { holdVoiceAlive } from '../../src/services/silentLoop';

const MIN = 60_000;

describe('holdWhileActive', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function fake() {
    const state = { taken: 0, released: 0 };
    const acquire = () => {
      state.taken += 1;
      return () => {
        state.released += 1;
      };
    };
    return { state, acquire };
  }

  it('is 5 minutes', () => {
    expect(TALK_IDLE_MS).toBe(5 * MIN);
  });

  it('takes the hold at once and lets it go after 5 minutes with no activity', () => {
    const { state, acquire } = fake();
    holdWhileActive(acquire);
    expect(state).toEqual({ taken: 1, released: 0 });
    vi.advanceTimersByTime(5 * MIN - 1);
    expect(state.released).toBe(0);
    vi.advanceTimersByTime(1);
    expect(state).toEqual({ taken: 1, released: 1 });
  });

  it('a hold, answer or tap (rearm) starts the 5 minutes again', () => {
    const { state, acquire } = fake();
    const held = holdWhileActive(acquire);
    vi.advanceTimersByTime(4 * MIN);
    held.rearm();
    vi.advanceTimersByTime(4 * MIN);
    expect(state.released).toBe(0);
    vi.advanceTimersByTime(MIN);
    expect(state.released).toBe(1);
  });

  it('takes the hold again when activity comes after it was let go, and lets go again after 5 more minutes', () => {
    const { state, acquire } = fake();
    const held = holdWhileActive(acquire);
    vi.advanceTimersByTime(6 * MIN);
    held.rearm();
    expect(state).toEqual({ taken: 2, released: 1 });
    vi.advanceTimersByTime(5 * MIN);
    expect(state).toEqual({ taken: 2, released: 2 });
  });

  it('release lets go once, stops the timer, and later activity takes nothing', () => {
    const { state, acquire } = fake();
    const held = holdWhileActive(acquire);
    held.release();
    held.release();
    held.rearm();
    vi.advanceTimersByTime(10 * MIN);
    expect(state).toEqual({ taken: 1, released: 1 });
  });

  it('release after the idle let-go does not let go twice', () => {
    const { state, acquire } = fake();
    const held = holdWhileActive(acquire);
    vi.advanceTimersByTime(6 * MIN);
    held.release();
    expect(state.released).toBe(1);
  });

  it('lets go of the real wake lock and the real silent loop', async () => {
    const release = vi.fn(() => Promise.resolve());
    const request = vi.fn(() => Promise.resolve({ release }));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true, writable: true });
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const awake = holdWhileActive(holdAwake);
    const loop = holdWhileActive(holdVoiceAlive);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(release).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
    awake.rearm();
    loop.rearm();
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(2);
    expect(play).toHaveBeenCalledTimes(2);
    awake.release();
    loop.release();
    vi.restoreAllMocks();
  });
});
