// tests/unit/unsettled-needs-re.test.ts — mw-gq6.735: unsettledNeeds (the Needs you list, the badge and the bead page)
// reads an answer's `re` as the card gets it (namesCard): an answer that names the older of two question cards on a
// bead does not hide the newer. An answer that names no card keeps the bead-and-time rule.
import { describe, expect, it } from 'vitest';
import type { AnswerRow, MessageRow } from '../../src/data/db';
import { unsettledNeeds } from '../../src/model/needs';
import type { Need } from '../../src/model/view';
import { encodeQuestion } from '../../src/services/questions';

const BEAD = 'mw-6ww.119';
const OLDER = `direct:${'a'.repeat(64)}`;
const NEWER = `direct:${'b'.repeat(64)}`;
const at = (hhmm: string) => Date.parse(`2026-10-15T${hhmm}:00Z`) / 1000;

function need(since: string, options: string[]): Need {
  return { kind: 'question', bead: BEAD, epic: '', title: 'Digest', since: new Date(at(since) * 1000).toISOString(), text: 'Which?', recommended: '', options, blocks: 0, steps: [] };
}

function ask(txid: string, ts: number, options: string[]): MessageRow {
  return { id: `${txid}:0`, txid, vout: 0, seq: ts, class: 'decision-needed', to: 't', from: 'f', ts, ciphertext: '', plaintext: encodeQuestion({ bead: BEAD, q: 'Which?', rec: '', options }), direction: 'received', read: true };
}

const older = need('10:05', ['Weekly', 'Per demo']);
const newer = need('12:07', ['Rebase', 'Merge']);
const posts = [ask(OLDER, at('10:05'), older.options), ask(NEWER, at('12:07'), newer.options)];
const answer = (ts: string, re?: string): AnswerRow => ({ bead: BEAD, answer: 'Weekly', txid: 'direct:cc', ts: at(ts), ...(re !== undefined ? { re } : {}) });

describe('unsettledNeeds with two question cards on one bead', () => {
  it('keeps the newer card when the answer, sent after both were asked, names the older', () => {
    expect(unsettledNeeds([older, newer], [answer('12:08', OLDER)], posts)).toEqual([newer]);
  });

  it('keeps the older card when the answer names the newer', () => {
    expect(unsettledNeeds([older, newer], [answer('12:08', NEWER)], posts)).toEqual([older]);
  });

  it('keeps today\'s rule for an answer with no re: it settles every card on the bead asked before it', () => {
    expect(unsettledNeeds([older, newer], [answer('12:08')], posts)).toEqual([]);
    expect(unsettledNeeds([older, newer], [answer('11:00')], posts)).toEqual([newer]);
  });

  it('keeps today\'s rule when the phone does not hold the question posts, so no card has a txid', () => {
    expect(unsettledNeeds([older, newer], [answer('12:08', OLDER)], [])).toEqual([]);
  });
});
