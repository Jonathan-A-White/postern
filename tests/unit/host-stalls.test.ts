// tests/unit/host-stalls.test.ts — mw-6ww.175.67: the stalls of the host that fall inside a timed window are what a spec adds to its promise.
import { describe, expect, it } from 'vitest';
import { stalledWithin } from '../e2e/host-slowdown';

describe('stalledWithin', () => {
  const stalls = [
    { end: 1_000, ms: 300 }, // 700-1000: before the window
    { end: 5_000, ms: 2_800 }, // 2200-5000: inside it
    { end: 12_000, ms: 400 }, // 11600-12000: after it
  ];

  it('adds up the stalls inside the window', () => {
    expect(stalledWithin(stalls, 2_000, 6_000)).toBe(2_800);
  });

  it('counts a stall that ends inside the window or begins inside it', () => {
    expect(stalledWithin(stalls, 4_000, 6_000)).toBe(2_800);
    expect(stalledWithin(stalls, 0, 2_500)).toBe(300 + 2_800);
  });

  it('is nothing for a calm window', () => {
    expect(stalledWithin(stalls, 6_000, 11_000)).toBe(0);
    expect(stalledWithin([], 0, 1e12)).toBe(0);
  });
});
