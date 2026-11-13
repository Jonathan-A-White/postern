// Every state millwright lets an item expect (docs/fixtures/contract.json expect_states) is one
// meetsExpectation can tick: the PWA's hand-copied lists (EVENT_KINDS, EXPECT_STATES, MET_BY) must not
// leave a state that millwright accepts waiting forever.
import { describe, expect, it } from 'vitest';
import contract from '../../docs/fixtures/contract.json';
import type { EventRow } from '../../src/data/db';
import { meetsExpectation } from '../../src/model/cards';

const event = (over: Partial<EventRow>): EventRow => ({
  seq: 1, ts: '2026-11-13T00:00:00Z', kind: 'bead_changed', bead: 'mw-1', actor: 'mw', from: 'open', to: 'open', detail: '', lane: 'x', ...over,
});

describe('every expect state in the contract can be met', () => {
  it.each(contract.expect_states)('%s is met by its own event', (state) => {
    const met = state === 'answered' ? event({ kind: 'card_answered' }) : event({ from: 'other', to: state });
    expect(meetsExpectation({ bead: 'mw-1', state }, met)).toBe(true);
    expect(meetsExpectation({ bead: 'mw-2', state }, met)).toBe(false);
  });
});
