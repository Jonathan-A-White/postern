import { describe, expect, it } from 'vitest';
import { decodeView } from '../../src/model/view';
import { orderedOptions } from '../../src/model/needs';
import { describeAction } from '../../src/model/conversation';
import { NEED_META } from '../../src/cockpit/labels';
import { fixtureStaleNeed, fixtureView } from '../support/cockpit-fixture';

describe('a stale need (docs/protocol.md §11)', () => {
  it('is decoded from the view rather than dropped', () => {
    const view = fixtureView();
    view.needs = [fixtureStaleNeed()];
    const decoded = decodeView(JSON.stringify(view));
    expect(decoded.needs.map((need) => need.kind)).toEqual(['stale']);
  });

  it('is chipped Still wanted? and always offers Keep then Close', () => {
    expect(NEED_META.stale.label).toBe('Still wanted?');
    expect(orderedOptions({ ...fixtureStaleNeed(), options: [] })).toEqual(['Keep', 'Close']);
  });

  it('reads keep and close actions as words', () => {
    expect(describeAction({ action: 'keep', bead: 'mw-1' })).toBe('Kept mw-1');
    expect(describeAction({ action: 'close', bead: 'mw-1' })).toBe('Closed mw-1');
  });
});
