import { describe, expect, it } from 'vitest';
import { hitlParts } from '../../src/model/needs';

describe('hitlParts (a hitl:<kind> need body, docs/protocol.md §11)', () => {
  it('splits Do this, Verified and Done when in the order written', () => {
    expect(hitlParts('Do this: approve the PR. Verified: CI is green. Done when: it is merged.')).toEqual([
      { label: 'Do this', text: 'approve the PR.' },
      { label: 'Verified', text: 'CI is green.' },
      { label: 'Done when', text: 'it is merged.' },
    ]);
  });

  it('keeps words before the first label, unlabelled', () => {
    expect(hitlParts('A PR from the TL. Do this approve it Done when merged')).toEqual([
      { label: '', text: 'A PR from the TL.' },
      { label: 'Do this', text: 'approve it' },
      { label: 'Done when', text: 'merged' },
    ]);
  });

  it('gives nothing when the body has no label', () => {
    expect(hitlParts('Pick a colour for the logo.')).toEqual([]);
  });
});
