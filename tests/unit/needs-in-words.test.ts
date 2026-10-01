import { describe, expect, it } from 'vitest';
import { answeredByComment, answeredQuestion, needOfQuestion, optionNamed } from '../../src/model/needs';
import { askedAgainAt, type ConversationItem } from '../../src/model/conversation';
import type { MessageRow } from '../../src/data/db';
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

describe('optionNamed on lettered options (mw-gq6.222)', () => {
  const lettered: Need = { ...need, options: ['A: It greyed out', 'B: It did not'] };
  it("names 'A: …' by its letter, as an uppercase word or after do / option / pick / choose / go with / answer", () => {
    for (const text of ['Do A', 'A', 'do a', 'option a', 'Go with A', 'pick a', 'Choose A.', 'answer: A', 'A please']) {
      expect(optionNamed(lettered, text), text).toBe('A: It greyed out');
    }
    expect(optionNamed(lettered, 'B please')).toBe('B: It did not');
    expect(optionNamed(lettered, 'option b')).toBe('B: It did not');
  });
  it('does not take a lowercase article for a letter', () => {
    for (const text of ['a good idea', 'I have a question', 'Maybe later', 'Banana', 'do apples']) {
      expect(optionNamed(lettered, text), text).toBeUndefined();
    }
  });
  it('still names an option by its whole label', () => {
    expect(optionNamed(lettered, 'a: it greyed out, I think')).toBe('A: It greyed out');
  });
  it('takes the earliest when a letter and another option are named', () => {
    expect(optionNamed(lettered, 'Do A, not B')).toBe('A: It greyed out');
    expect(optionNamed(lettered, 'B: it did not, rather than A')).toBe('B: It did not');
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

describe('answeredQuestion (mw-gq6.214)', () => {
  const asked = Date.parse('2026-10-01T12:00:00Z');
  const question = { bead: 'mw-q', q: 'Which?', rec: 'A', options: ['A', 'B'] };
  const asking = needOfQuestion(question, asked);
  const typed = (text: string, atMs: number): MessageRow => ({
    id: `m${atMs}`, txid: `direct:${atMs}`, vout: 0, seq: 1, class: 'message', to: '', from: '', ts: Math.floor(atMs / 1000), ciphertext: '', plaintext: text, direction: 'sent', read: true, thread: 'bead:mw-q',
  });
  const none = { sent: [], comments: [], messages: [], outbox: [], soleQuestion: false };

  it('builds the card the post stands for', () => {
    expect(asking).toMatchObject({ kind: 'question', bead: 'mw-q', since: '2026-10-01T12:00:00.000Z', options: ['A', 'B'], recommended: 'A' });
  });
  it('reads his words naming an option, an ANSWER comment, and the answer this phone sent', () => {
    expect(answeredQuestion(asking, { ...none, messages: [typed('B please', asked + 60_000)] })).toEqual({ label: 'B', at: asked + 60_000 });
    expect(answeredQuestion(asking, { ...none, comments: [{ at: '2026-10-01T12:05:00Z', author: 'root', text: 'Answer: A' }] })?.label).toBe('A');
    expect(answeredQuestion(asking, { ...none, sent: [{ bead: 'mw-q', answer: 'B', txid: 'direct:1', ts: asked / 1000 + 30 }] })).toEqual({ label: 'B', at: asked + 30_000 });
  });
  it('ignores what came before the question and what names no option', () => {
    expect(answeredQuestion(asking, { ...none, messages: [typed('B', asked - 60_000), typed('maybe', asked + 60_000)] })).toBeUndefined();
    expect(answeredQuestion(asking, { ...none, sent: [{ bead: 'mw-q', answer: 'B', txid: 'direct:1', ts: asked / 1000 - 30 }] })).toBeUndefined();
  });
  it('stops at the time the bead asked again', () => {
    const evidence = { ...none, messages: [typed('B', asked + 120_000)], comments: [{ at: '2026-10-01T12:03:00Z', author: 'root', text: 'Answer: A' }] };
    expect(answeredQuestion(asking, evidence, asked + 60_000)).toBeUndefined();
    expect(answeredQuestion(asking, evidence, asked + 600_000)).toBeDefined();
  });
});

describe('askedAgainAt (mw-gq6.214)', () => {
  const ask = (id: string, bead: string, at: number): ConversationItem => ({ id, at, speaker: 'mayor', speakerLabel: 'Mayor', kind: 'question', text: 'q', source: 'message', question: { bead, q: 'q', rec: '', options: [] } });
  it('names, for each question, when the same bead asked next', () => {
    const again = askedAgainAt([ask('a', 'mw-1', 10), ask('b', 'mw-2', 20), ask('c', 'mw-1', 30)]);
    expect(again.get('a')).toBe(30);
    expect(again.has('b')).toBe(false);
    expect(again.has('c')).toBe(false);
  });
});
