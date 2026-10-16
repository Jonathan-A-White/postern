// tests/unit/iced-status.test.ts — mw-njb33n.1: a bead with the icebox label reads
// 'Iced', whatever its status; the rest read as they did.
import { describe, expect, it } from 'vitest';
import { statusWord } from '../../src/cockpit/labels';
import { isIced } from '../../src/model/tree';

describe('statusWord', () => {
  it("reads 'Iced' for a bead labelled icebox, whatever its status", () => {
    expect(statusWord('deferred', ['icebox'])).toBe('Iced');
    expect(statusWord('open', ['hitl', 'icebox'])).toBe('Iced');
    expect(statusWord('closed', ['icebox'])).toBe('Iced');
  });

  it("still reads 'Held' for a deferred bead without the label", () => {
    expect(statusWord('deferred', ['hitl'])).toBe('Held');
    expect(statusWord('deferred')).toBe('Held');
  });
});

describe('isIced', () => {
  it('is true for the icebox label only', () => {
    expect(isIced({ labels: ['icebox'] })).toBe(true);
    expect(isIced({ labels: ['wayfinder:map'] })).toBe(false);
  });
});
