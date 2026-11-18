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

describe('statusWord for a queued story (mw-ud3caof)', () => {
  it("does not read 'In progress' for a story labelled run:queued", () => {
    expect(statusWord('in_progress', ['run:queued'])).not.toBe('In progress');
    expect(statusWord('in_progress', ['run:queued'])).toBe('Blocked');
  });

  it("still reads 'In progress' for an in-progress story that is not queued", () => {
    expect(statusWord('in_progress', ['hitl'])).toBe('In progress');
    expect(statusWord('in_progress')).toBe('In progress');
  });
});

describe('isIced', () => {
  it('is true for the icebox label only', () => {
    expect(isIced({ labels: ['icebox'] })).toBe(true);
    expect(isIced({ labels: ['wayfinder:map'] })).toBe(false);
  });
});
