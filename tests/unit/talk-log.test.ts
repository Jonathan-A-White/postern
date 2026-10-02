// mw-am3yjh.1: the Talk screen's log, and the line under it, rebuilt from the stored `talk` rows.
import { describe, expect, it } from 'vitest';
import type { MessageRow } from '../../src/data/db';
import { openTalk, talksFromRows } from '../../src/model/talkLog';
import { encodeTurn } from '../../src/services/talk';
import { TALK_AWAY_TIMEOUT_MS, NO_ANSWER_IN_TIME, type TalkTurn } from '../../src/model/talkLine';

let n = 0;
function row(turn: TalkTurn, direction: 'sent' | 'received', ts: number, extra: Partial<MessageRow> = {}): MessageRow {
  n += 1;
  return {
    id: `direct:${n}:0`,
    txid: `direct:${n}`,
    vout: 0,
    seq: n,
    class: 'talk',
    to: '03',
    from: '02',
    ts,
    ciphertext: '',
    plaintext: encodeTurn(turn),
    direction,
    read: true,
    ...extra,
  };
}
const his = (id: string, turn: number, text: string, ts: number, extra: Partial<TalkTurn> = {}) => row({ talk: { id, turn }, text, role: 'turn', ...extra }, 'sent', ts);
const answer = (id: string, turn: number, text: string, ts: number, extra: Partial<MessageRow> & Partial<TalkTurn> = {}) => {
  const { heard, ...turnExtra } = extra;
  return row({ talk: { id, turn }, text, role: 'answer', ...turnExtra }, 'received', ts, heard === undefined ? {} : { heard });
};
const ended = (id: string, turn: number, ts: number) => row({ talk: { id, turn }, text: '', role: 'end' }, 'sent', ts);

const T0 = 1_760_000_000;
const NOW = (T0 + 10) * 1000;

describe('talksFromRows', () => {
  it('groups the rows by talk id, each talk with its turns in order whatever order the rows come in', () => {
    const rows = [answer('a', 1, 'Hi.', T0 + 2), his('a', 2, 'More?', T0 + 3), his('a', 1, 'Hello', T0 + 1), his('b', 1, 'Other', T0 + 5)];
    const talks = talksFromRows(rows);
    expect(talks.map((talk) => talk.id)).toEqual(['a', 'b']);
    expect(talks[0].log.map((entry) => [entry.turn, entry.said, entry.answer])).toEqual([
      [1, 'Hello', 'Hi.'],
      [2, 'More?', undefined],
    ]);
  });

  it('gives each turn its answer, how soon the first words came, the model, the links and whether it was heard', () => {
    const rows = [his('a', 1, 'Hello', T0, { model: 'opus', cut: true }), answer('a', 1, 'Hi.', T0 + 3, { model: 'sonnet', links: ['mw-1'], heard: false })];
    expect(talksFromRows(rows)[0].log).toEqual([
      { turn: 1, said: 'Hello', cut: true, asked: 'opus', releasedAt: T0 * 1000, answer: 'Hi.', answered: true, links: ['mw-1'], answeredBy: 'sonnet', firstWordsMs: 3000, heard: false },
    ]);
  });

  it('shows a holding answer until the real one comes, and the real one then replaces it', () => {
    const holding = row({ talk: { id: 'a', turn: 1 }, text: 'One moment.', role: 'holding' }, 'received', T0 + 1);
    const base = his('a', 1, 'Hello', T0);
    const [held] = talksFromRows([base, holding])[0].log;
    expect(held.answer).toBe('One moment.');
    expect(held.answered).toBe(false);
    const [done] = talksFromRows([base, holding, answer('a', 1, 'Done.', T0 + 4)])[0].log;
    expect(done.answer).toBe('Done.');
    expect(done.answered).toBe(true);
  });

  it('leaves out rows that are not turns: undecrypted, unreadable, and a turn he made that never gets a number', () => {
    const locked = his('a', 1, 'Hello', T0, {});
    delete locked.plaintext;
    const junk = his('a', 2, 'x', T0 + 1);
    junk.plaintext = 'not json';
    expect(talksFromRows([locked, junk])).toEqual([]);
  });

  it('says a talk has ended once it holds an end turn, his or the Mayor\'s', () => {
    expect(talksFromRows([his('a', 1, 'Hello', T0), ended('a', 1, T0 + 1)])[0].ended).toBe(true);
    expect(talksFromRows([his('a', 1, 'Hello', T0)])[0].ended).toBe(false);
  });
});

describe('openTalk', () => {
  it('is the newest talk, and only it: rows of two talks give the log of the newer one in order', () => {
    const rows = [his('old', 1, 'Old words', T0), answer('old', 1, 'Old answer', T0 + 1), his('new', 1, 'First', T0 + 100), answer('new', 1, 'Second', T0 + 101, { heard: true }), his('new', 2, 'Third', T0 + 102)];
    const open = openTalk(rows, NOW)!;
    expect(open.id).toBe('new');
    expect(open.log.map((entry) => entry.said)).toEqual(['First', 'Third']);
    expect(open.log.some((entry) => entry.said === 'Old words')).toBe(false);
  });

  it('is nothing when the newest talk has ended, even though an older one never did', () => {
    const rows = [his('old', 1, 'Old', T0), his('new', 1, 'New', T0 + 100), ended('new', 1, T0 + 101)];
    expect(openTalk(rows, NOW)).toBeUndefined();
  });

  it('is nothing when there are no rows', () => {
    expect(openTalk([], NOW)).toBeUndefined();
  });

  it('makes a line that continues the talk: its id, the number of his last turn and the model he chose', () => {
    const rows = [his('a', 1, 'Hello', T0, { model: 'fable' }), answer('a', 1, 'Hi.', T0 + 2, { heard: true }), his('a', 2, 'More', T0 + 5, { model: 'fable' }), answer('a', 2, 'Sure.', T0 + 6, { heard: true })];
    const { line } = openTalk(rows, NOW)!;
    expect(line.talk).toEqual({ id: 'a', turn: 2 });
    expect(line.model).toBe('fable');
    expect(line.phase).toBe('idle');
    expect(line.speaking).toBeUndefined();
  });

  it('has the last answer wait to be spoken when it was never heard', () => {
    const rows = [his('a', 1, 'Hello', T0), answer('a', 1, 'Hi.', T0 + 2, { heard: false, links: ['mw-9'] })];
    const open = openTalk(rows, NOW)!;
    expect(open.line.phase).toBe('speaking');
    expect(open.line.speaking).toEqual({ text: 'Hi.', holding: false, links: ['mw-9'] });
    expect(open.unheardRow).toBe(rows[1].id);
    expect(open.rows).toEqual(rows.map((r) => r.id));
  });

  it('does not speak an answer that was heard, nor one stored before rows said whether they were heard', () => {
    const heard = [his('a', 1, 'Hello', T0), answer('a', 1, 'Hi.', T0 + 2, { heard: true })];
    expect(openTalk(heard, NOW)!.line.phase).toBe('idle');
    const legacy = [his('a', 1, 'Hello', T0), answer('a', 1, 'Hi.', T0 + 2)];
    expect(openTalk(legacy, NOW)!.line.phase).toBe('idle');
    expect(openTalk(legacy, NOW)!.log[0].heard).toBeUndefined();
  });

  it('waits for the Mayor when his last turn has no answer yet, and gives up as the line does once the wait is over', () => {
    const rows = [his('a', 1, 'Hello', T0 + 9)];
    const waiting = openTalk(rows, NOW)!.line;
    expect(waiting.phase).toBe('waiting');
    expect(waiting.sentAt).toBe((T0 + 9) * 1000);
    const late = openTalk(rows, (T0 + 9) * 1000 + TALK_AWAY_TIMEOUT_MS)!.line;
    expect(late.phase).toBe('idle');
    expect(late.error).toBe(NO_ANSWER_IN_TIME);
    expect(late.talk).toEqual({ id: 'a', turn: 1 });
  });
});
