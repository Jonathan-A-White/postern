// docs/protocol.md §11: a need says who it waits on (waits_for), and a hands or demo
// card that cannot be acted on yet says so (not_ready, waiting_on). A view from an
// older mw carries none of the three and must decode to the same Need shape.
import { describe, expect, it } from 'vitest';
import { decodeView } from '../../src/model/view';
import { fixtureView } from '../support/cockpit-fixture';

function decodeNeeds(needs: Record<string, unknown>[]) {
  const view = { ...fixtureView(), needs };
  return decodeView(JSON.stringify(view)).needs;
}

const BASE = {
  kind: 'hands',
  bead: 'mw-f758y.8',
  epic: 'mw-f758y',
  title: 'Enable linger',
  since: '2026-09-28T10:00:00Z',
  text: 'A step only his hands can do.',
  recommended: '',
  options: [],
  blocks: 0,
};

describe('a need that says who it waits on (docs/protocol.md §11)', () => {
  it('reads waits_for, not_ready and waiting_on from the view', () => {
    const [need] = decodeNeeds([{ ...BASE, waits_for: 'factory', not_ready: true, waiting_on: ['Build the runner'] }]);
    expect(need.waits_for).toBe('factory');
    expect(need.not_ready).toBe(true);
    expect(need.waiting_on).toEqual(['Build the runner']);
  });

  it('reads the same Need shape from an older mw that sends none of them', () => {
    const [withFields] = decodeNeeds([{ ...BASE, waits_for: 'you', not_ready: false, waiting_on: [] }]);
    const [older] = decodeNeeds([BASE]);
    expect(Object.keys(older).sort()).toEqual(Object.keys(withFields).sort());
    expect(older).toEqual(withFields);
    expect(older.waits_for).toBe('you');
    expect(older.not_ready).toBe(false);
    expect(older.waiting_on).toEqual([]);
  });

  it('takes an unknown waits_for as you, so a card is never hidden by a newer word', () => {
    const [need] = decodeNeeds([{ ...BASE, waits_for: 'somebody' }]);
    expect(need.waits_for).toBe('you');
  });

  it('keeps only strings in waiting_on', () => {
    const [need] = decodeNeeds([{ ...BASE, not_ready: true, waiting_on: ['A', 3, null, 'B'] }]);
    expect(need.waiting_on).toEqual(['A', 'B']);
  });
});
