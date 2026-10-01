import { describe, expect, it } from 'vitest';
import { answeredByComment, optionNamed } from '../../src/model/needs';
import type { Need } from '../../src/model/view';

const need: Need = { kind: 'question', bead: 'mw-q', epic: '', title: 't', since: '2026-10-01T12:00:00Z', text: 'q', recommended: '', options: ['A', 'B', 'Do B now'], blocks: 0, steps: [] };

describe('optionNamed (mw-gq6.199)', () => {
  it('names an option as a whole word, any case', () => {
    expect(optionNamed(need, 'Do a')).toBe('A');
    expect(optionNamed(need, 'b, please')).toBe('B');
  });
  it('does not find an option inside another word', () => {
    expect(optionNamed(need, 'Maybe later; abandon')).toBeUndefined();
  });
  it('prefers the longest option named', () => {
    expect(optionNamed(need, 'do b now')).toBe('Do B now');
  });
});

describe('answeredByComment (mw-gq6.199)', () => {
  const at = '2026-10-01T13:00:00Z';
  it('reads the answer after the txid', () => {
    expect(answeredByComment(need, [{ at, author: 'mw@laptop', text: 'ANSWER 2026-10-01T13:00:00Z from 02ab, txid direct:aa: Do A' }])?.label).toBe('Do A');
  });
  it('reads a bare Answer comment', () => {
    expect(answeredByComment(need, [{ at, author: 'root', text: 'Answer: B' }])?.label).toBe('B');
  });
  it('ignores one from before the question and any other comment', () => {
    expect(answeredByComment(need, [{ at: '2026-10-01T11:00:00Z', author: 'root', text: 'Answer: B' }])).toBeUndefined();
    expect(answeredByComment(need, [{ at, author: 'root', text: 'Answering later' }])).toBeUndefined();
  });
});
