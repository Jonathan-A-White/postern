// tests/unit/answer-re.test.ts — mw-1cfk7g.1: an answer names the question card it answers (its
// reply record's `re`, docs/protocol.md §6), so one tap on one of two cards on a bead marks that card
// only. An answer without `re` (an old record) keeps the bead-and-window rule.
import { afterEach, describe, expect, it } from 'vitest';
import { db, type MessageRow, type OutboxRow } from '../../src/data/db';
import { sendAnswer } from '../../src/cockpit/send';
import { answersGiven, mergeConversation } from '../../src/model/conversation';
import { answeredQuestion, needOfQuestion, questionTxidOf } from '../../src/model/needs';
import { pendingAnswer } from '../../src/model/outbox';
import { decodeReply, encodeQuestion, encodeReply } from '../../src/services/questions';

const BEAD = 'mw-6ww.119';
const Q4 = `direct:${'a'.repeat(64)}`;
const RUSH = `direct:${'b'.repeat(64)}`;
const at = (hhmm: string) => Date.parse(`2026-10-15T${hhmm}:00Z`) / 1000;

function ask(txid: string, ts: number, options = ['A', 'B']): MessageRow {
  return { id: `${txid}:0`, txid, vout: 0, seq: ts, class: 'decision-needed', to: 't', from: 'f', ts, ciphertext: '', plaintext: encodeQuestion({ bead: BEAD, q: 'Which?', rec: '', options }), direction: 'received', read: true };
}

function reply(txid: string, ts: number, body: { answer: string; re?: string }): MessageRow {
  return { id: `${txid}:0`, txid, vout: 0, seq: ts, class: 'message', to: 't', from: 'f', ts, ciphertext: '', plaintext: encodeReply({ bead: BEAD, ...body }), direction: 'sent', read: true };
}

afterEach(async () => {
  await db.outbox.clear();
});

describe('a reply record', () => {
  it('carries re when it has one and none when it has none', () => {
    expect(decodeReply(encodeReply({ bead: BEAD, answer: 'A', re: Q4 }))).toEqual({ bead: BEAD, answer: 'A', re: Q4 });
    expect(JSON.parse(encodeReply({ bead: BEAD, answer: 'A' }))).not.toHaveProperty('re');
    expect(decodeReply(encodeReply({ bead: BEAD, answer: 'A' }))).not.toHaveProperty('re');
  });
});

describe('answersGiven with two cards on one bead', () => {
  it('marks only the card the answer names, though the other was asked before the tap', () => {
    const items = mergeConversation([ask(Q4, at('10:05')), ask(RUSH, at('12:07'), ['A', 'B', 'C']), reply(`direct:${'c'.repeat(64)}`, at('12:08'), { answer: 'A: One weekly digest', re: Q4 })]);
    const given = answersGiven(items);
    const [q4, rush] = items.filter((item) => item.kind === 'question');
    expect(given.get(q4.id)).toMatchObject({ answer: 'A: One weekly digest' });
    expect(given.has(rush.id)).toBe(false);
  });

  it('marks the later card when the answer names it, and leaves the earlier one open', () => {
    const items = mergeConversation([ask(Q4, at('10:05')), ask(RUSH, at('12:07')), reply(`direct:${'c'.repeat(64)}`, at('12:08'), { answer: 'B', re: RUSH })]);
    const given = answersGiven(items);
    const [q4, rush] = items.filter((item) => item.kind === 'question');
    expect(given.has(q4.id)).toBe(false);
    expect(given.get(rush.id)).toMatchObject({ answer: 'B' });
  });

  it('keeps today\'s window rule for an answer with no re', () => {
    const items = mergeConversation([ask(Q4, at('10:05')), reply(`direct:${'c'.repeat(64)}`, at('10:06'), { answer: 'A' }), ask(RUSH, at('12:07'))]);
    const given = answersGiven(items);
    const [q4, rush] = items.filter((item) => item.kind === 'question');
    expect(given.get(q4.id)).toMatchObject({ answer: 'A' });
    expect(given.has(rush.id)).toBe(false);
  });
});

describe('the other evidence of an answer, for a card with a txid', () => {
  const question = { bead: BEAD, q: 'Which?', rec: '', options: ['A', 'B'] };
  const noEvidence = { comments: [], messages: [], outbox: [], soleQuestion: false };
  const sent = (re?: string) => [{ bead: BEAD, answer: 'A', txid: 'direct:1', ts: at('12:08'), ...(re !== undefined ? { re } : {}) }];

  it("a record that names the first card is not the second card's answer", () => {
    const rush = needOfQuestion(question, at('12:07') * 1000);
    expect(answeredQuestion(rush, { ...noEvidence, sent: sent(Q4), txid: RUSH })).toBeUndefined();
    expect(answeredQuestion(rush, { ...noEvidence, sent: sent(RUSH), txid: RUSH })).toMatchObject({ label: 'A' });
  });

  it('a record with no re still answers by bead and time', () => {
    const rush = needOfQuestion(question, at('12:07') * 1000);
    expect(answeredQuestion(rush, { ...noEvidence, sent: sent(), txid: RUSH })).toMatchObject({ label: 'A' });
  });

  it('a queued answer that names the first card is pending for that card only', () => {
    const row = { id: 1, kind: 'answer', bead: BEAD, payload: { answer: 'A', re: Q4 }, created: at('12:08') * 1000, attempts: 0, state: 'pending' } as OutboxRow;
    expect(pendingAnswer([row], BEAD, at('10:05') * 1000, Q4)).toBe(row);
    expect(pendingAnswer([row], BEAD, at('12:07') * 1000, RUSH)).toBeUndefined();
    expect(pendingAnswer([{ ...row, payload: { answer: 'A' } }], BEAD, at('12:07') * 1000, RUSH)).toBeDefined();
  });
});

describe('the card a Needs card stands for', () => {
  const need = needOfQuestion({ bead: BEAD, q: 'Which?', rec: '', options: ['A', 'B'] }, at('12:07') * 1000);

  it('is the question post on its bead asked nearest its since', () => {
    expect(questionTxidOf(need, [ask(Q4, at('10:05')), ask(RUSH, at('12:07'))])).toBe(RUSH);
    expect(questionTxidOf(need, [ask(Q4, at('12:07')), ask(RUSH, at('13:30'))])).toBe(Q4);
  });

  it('is unknown when the thread holds no question on the bead', () => {
    expect(questionTxidOf(need, [])).toBeUndefined();
  });
});

describe('sendAnswer', () => {
  it("queues the card's txid as the record's re", async () => {
    const { id } = await sendAnswer(BEAD, 'A', Q4);
    expect((await db.outbox.get(id))?.payload).toMatchObject({ answer: 'A', re: Q4 });
  });

  it('queues no re when no card is named', async () => {
    const { id } = await sendAnswer(BEAD, 'A');
    expect((await db.outbox.get(id))?.payload).not.toHaveProperty('re');
  });
});

// mw-gq6.733: his case. Choice 3 (asked 09:38) sits above Choice 2 (asked 15:37); he tapped A on Choice 3 at 15:42.
// The factory wrote an ANSWER comment on the bead naming that answer's txid, not the card, and it was read as Choice 2's answer too.
describe('two cards on one bead, the factory\'s ANSWER comment (mw-gq6.733)', () => {
  const OLDER = `direct:${'f'.repeat(64)}`;
  const NEWER = `direct:${'1'.repeat(64)}`;
  const ANSWER_TX = `direct:${'9'.repeat(64)}`;
  const question = { bead: BEAD, q: 'Which?', rec: '', options: ['A: Every matched book turns On', 'B: Leave it'] };
  const comment = { at: `2026-10-23T${'15:42'}:30Z`, author: 'mw@laptop', text: `ANSWER 2026-10-23T15:42:00Z from 02ab, txid ${ANSWER_TX}: A: Every matched book turns On` };
  const day = (hhmm: string) => Date.parse(`2026-10-23T${hhmm}:00Z`) / 1000;
  const evidence = (re?: string) => ({
    sent: [{ bead: BEAD, answer: 'A: Every matched book turns On', txid: ANSWER_TX, ts: day('15:42'), ...(re !== undefined ? { re } : {}) }],
    comments: [comment],
    messages: [],
    outbox: [],
    soleQuestion: false,
  });

  it('marks the older card, which the answer names, and leaves the newer one open', () => {
    const older = needOfQuestion(question, day('09:38') * 1000);
    const newer = needOfQuestion(question, day('15:37') * 1000);
    expect(answeredQuestion(older, { ...evidence(OLDER), txid: OLDER }, day('15:37') * 1000)).toMatchObject({ label: 'A: Every matched book turns On' });
    expect(answeredQuestion(newer, { ...evidence(OLDER), txid: NEWER })).toBeUndefined();
  });

  it('still marks a card from the comment when the answer names no card', () => {
    const newer = needOfQuestion(question, day('15:37') * 1000);
    expect(answeredQuestion(newer, { ...evidence(), txid: NEWER })).toMatchObject({ label: 'A: Every matched book turns On' });
  });

  it('still marks a card from a comment whose answer this phone did not send', () => {
    const newer = needOfQuestion(question, day('15:37') * 1000);
    expect(answeredQuestion(newer, { ...evidence(OLDER), sent: [], txid: NEWER })).toMatchObject({ label: 'A: Every matched book turns On' });
  });

  it('marks the newer card from the comment when the answer names it', () => {
    const newer = needOfQuestion(question, day('15:37') * 1000);
    expect(answeredQuestion(newer, { ...evidence(NEWER), txid: NEWER })).toMatchObject({ label: 'A: Every matched book turns On' });
  });
});
