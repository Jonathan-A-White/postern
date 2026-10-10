// docs/protocol.md §11: a `waiting` need (a bead the factory asked somebody else about) waits_for `others`;
// a `chase` need is his. The app lists the first apart and never counts it among what waits on him.
import { describe, expect, it } from 'vitest';
import { decodeView, type Need } from '../../src/model/view';
import { CHASE_ACTIONS, CHASE_OPTIONS, needsByWaiter, orderedOptions, unsettledNeeds } from '../../src/model/needs';
import { factoryStats, indexView } from '../../src/model/tree';
import { NEED_META } from '../../src/cockpit/labels';
import { fixtureView } from '../support/cockpit-fixture';

const WAITING = {
  kind: 'waiting',
  bead: 'mw-ask.1',
  epic: '',
  title: 'Write the permissions memo',
  since: '2026-10-09T12:00:00Z',
  text: 'Waiting on sam (tl) since 9 Oct 12:00 UTC',
  recommended: '',
  options: [],
  blocks: 0,
  waits_for: 'others',
};
const CHASE = { ...WAITING, kind: 'chase', text: 'Chase sam on Write the permissions memo', waits_for: 'you' };

function decodeNeeds(needs: Record<string, unknown>[]): Need[] {
  return decodeView(JSON.stringify({ ...fixtureView(), needs })).needs;
}

describe('Waiting on others and the chase need (docs/protocol.md §11)', () => {
  it('reads a waiting need as waiting for others, and a chase need as his', () => {
    const [waiting, chase] = decodeNeeds([WAITING, CHASE]);
    expect(waiting).toMatchObject({ kind: 'waiting', waits_for: 'others', text: 'Waiting on sam (tl) since 9 Oct 12:00 UTC' });
    expect(chase).toMatchObject({ kind: 'chase', waits_for: 'you' });
  });

  it('still reads a word it does not know as you', () => {
    const [need] = decodeNeeds([{ ...CHASE, waits_for: 'somebody' }]);
    expect(need.waits_for).toBe('you');
  });

  it('splits the waiting need into its own part, apart from You, Mayor and Factory', () => {
    const [waiting, chase] = decodeNeeds([WAITING, CHASE]);
    const split = needsByWaiter([waiting, chase]);
    expect(split.others).toEqual([waiting]);
    expect(split.you).toEqual([chase]);
    expect(split.mayor).toEqual([]);
    expect(split.factory).toEqual([]);
  });

  it('keeps a waiting need whatever he tapped on its bead since, but not a chase he answered', () => {
    const [waiting, chase] = decodeNeeds([WAITING, CHASE]);
    const answers = [{ bead: 'mw-ask.1', answer: 'keep_waiting', txid: 'direct:x', ts: Date.parse('2026-10-10T12:00:00Z') / 1000 }];
    expect(unsettledNeeds([waiting, chase], answers)).toEqual([waiting]);
  });

  it('does not count a bead waiting on others among the needs that wait on him', () => {
    const view = { ...fixtureView(), needs: decodeNeeds([WAITING, CHASE]) };
    expect(factoryStats(indexView(view)).needs).toBe(1);
  });

  it('offers a chase need Chase, Done and Keep waiting, each its §13 action', () => {
    const [, chase] = decodeNeeds([WAITING, CHASE]);
    expect(orderedOptions(chase)).toEqual(['Chase', 'Done', 'Keep waiting']);
    expect(CHASE_OPTIONS.map((option) => CHASE_ACTIONS[option])).toEqual(['chase', 'ask_done', 'keep_waiting']);
  });

  it('gives each kind its own chip', () => {
    expect(NEED_META.waiting.label).toBe('Waiting on others');
    expect(NEED_META.chase.label).toBe('Chase');
  });
});
