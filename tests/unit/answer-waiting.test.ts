// mw-am3yjh.3: a Mayor answer that arrives while the page is showing a screen other than the Talk line is
// remembered, so a bar can say it is waiting; the Talk line, a hidden page and an old answer say nothing.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MessageRow } from '../../src/data/db';
import { encodeTurn } from '../../src/services/talk';
import { ANSWER_FRESH_SECONDS, dismissAnswerWaiting, getAnswerWaiting, noteArrivedAnswer } from '../../src/services/answerWaiting';

const NOW = 1_790_000_000;

const answer = (over: Partial<MessageRow> = {}): MessageRow => ({
  id: 'a:0', txid: 'a', vout: 0, seq: 1, class: 'talk', to: 'phone', from: 'mayor', ts: NOW - 5, ciphertext: 'ct',
  plaintext: encodeTurn({ talk: { id: 't1', turn: 1 }, text: 'Done.', role: 'answer' }), direction: 'received', read: true, thread: 'talk', heard: false, ...over,
});

let hidden = false;
beforeEach(() => {
  hidden = false;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  window.history.replaceState(null, '', '/?v=talk');
});
afterEach(() => {
  dismissAnswerWaiting();
});

describe('which arrivals are remembered', () => {
  it('remembers an unheard answer that arrives while the page shows a screen other than the Talk line', () => {
    noteArrivedAnswer(answer(), NOW);
    expect(getAnswerWaiting()).toEqual({ id: 'a:0' });
  });

  it('does so on every other screen too', () => {
    for (const search of ['?v=needs', '?v=map', '?v=search', '?v=me', '']) {
      window.history.replaceState(null, '', `/${search}`);
      noteArrivedAnswer(answer(), NOW);
      expect(getAnswerWaiting(), search).toEqual({ id: 'a:0' });
      dismissAnswerWaiting();
    }
  });

  it('says nothing while the Talk line is showing', () => {
    window.history.replaceState(null, '', '/?v=line');
    noteArrivedAnswer(answer(), NOW);
    expect(getAnswerWaiting()).toBeUndefined();
  });

  it('says nothing while the page is hidden', () => {
    hidden = true;
    noteArrivedAnswer(answer(), NOW);
    expect(getAnswerWaiting()).toBeUndefined();
  });

  it('says nothing for what is not an unheard answer from the Mayor, or is an old one', () => {
    const turn = encodeTurn({ talk: { id: 't1', turn: 1 }, text: 'Hello', role: 'turn' });
    const holding = encodeTurn({ talk: { id: 't1', turn: 1 }, text: 'One moment.', role: 'holding' });
    for (const row of [
      answer({ direction: 'sent' }),
      answer({ plaintext: turn }),
      answer({ plaintext: holding }),
      answer({ plaintext: undefined }),
      answer({ class: 'message', plaintext: 'hello' }),
      answer({ heard: true }),
      answer({ ts: NOW - ANSWER_FRESH_SECONDS - 1 }),
    ]) {
      noteArrivedAnswer(row, NOW);
      expect(getAnswerWaiting()).toBeUndefined();
    }
  });
});

describe('putting it away', () => {
  it('forgets the answer, and does nothing when none is waiting', () => {
    noteArrivedAnswer(answer(), NOW);
    dismissAnswerWaiting();
    expect(getAnswerWaiting()).toBeUndefined();
    dismissAnswerWaiting();
    expect(getAnswerWaiting()).toBeUndefined();
  });
});
