// tests/unit/verified.test.ts — mw-581qad.1: the words a Verified tap sends, and how the outbox
// treats the message that carries them (it settles `verified` like an action did).
import { describe, expect, it } from 'vitest';
import type { OutboxRow } from '../../src/data/db';
import { VERIFIED_SOURCES, verifiedWords } from '../../src/model/verified';
import { pendingAction } from '../../src/model/outbox';

function row(over: Partial<OutboxRow>): OutboxRow {
  return { id: 1, kind: 'message', bead: 'mw-v', payload: { text: 'hi', files: [] }, created: 1000, attempts: 0, state: 'pending', ...over };
}

describe('verifiedWords', () => {
  it('begins with VERIFIED and names where the button was tapped', () => {
    expect(verifiedWords('mw-v', 'needs')).toBe('VERIFIED (tapped Verified in Needs you)');
    expect(verifiedWords('mw-v', 'page')).toBe("VERIFIED (tapped Verified on mw-v's page)");
    expect(verifiedWords('mw-v', 'channel')).toBe("VERIFIED (tapped Verified under HOW TO CHECK IT in mw-v's channel)");
  });

  it('has a source for each place', () => {
    expect(Object.keys(VERIFIED_SOURCES).sort()).toEqual(['channel', 'needs', 'page']);
  });
});

describe('a queued message that settles verified', () => {
  it('holds the verified action pending for its bead, until it has gone', () => {
    const queued = row({ payload: { text: verifiedWords('mw-v', 'needs'), files: [], settles: 'verified' } });
    expect(pendingAction([queued], 'mw-v', 'verified')).toBe(queued);
    expect(pendingAction([queued], 'mw-v', 'release')).toBeUndefined();
    expect(pendingAction([queued], 'mw-other', 'verified')).toBeUndefined();
    expect(pendingAction([{ ...queued, state: 'sent' }], 'mw-v', 'verified')).toBeUndefined();
    expect(pendingAction([row({})], 'mw-v', 'verified')).toBeUndefined();
  });
});
