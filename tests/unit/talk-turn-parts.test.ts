// mw-8ifimx.16: a turn over the cap goes as several records of the same talk and turn, part k of n, never cut with '...'
// (his Life Story turn lost its tail to the old cut). docs/protocol.md §20.
import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_ROOM_BYTES,
  TURN_TEXT_MAX_BYTES,
  initialTalkLine,
  talkLine,
  turnRecords,
  type TalkLineState,
} from '../../src/model/talkLine';
import { decodeTurn, encodeTurn } from '../../src/services/talk';
import { talksFromRows } from '../../src/model/talkLog';
import type { MessageRow } from '../../src/data/db';

/** The bytes the text takes inside the turn's JSON plaintext (escapes count). */
const bytes = (text: string) => new TextEncoder().encode(JSON.stringify(text)).length - 2;
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 97}`).join(' ');
const said = (text: string, from: TalkLineState = initialTalkLine) => talkLine(talkLine(from, { type: 'hold', talkId: 't1' }), { type: 'release', text });
const picture = { name: 'a.jpg', type: 'image/jpeg', bytes: new Uint8Array([1]) };

describe('a turn over the cap goes as parts', () => {
  it('20,000 bytes of words go as 3 records, part 1, 2 and 3 of 3, and join to exactly what he said', () => {
    const text = 'a'.repeat(20_000);
    const line = said(text);
    expect(line.phase).toBe('sending');
    const records = turnRecords(line.outgoing!, 0);
    expect(records).toHaveLength(3);
    expect(records.map((r) => [r.part, r.parts])).toEqual([[1, 3], [2, 3], [3, 3]]);
    for (const r of records) {
      expect(r.talk).toEqual({ id: 't1', turn: 1 });
      expect(r.role).toBe('turn');
      expect(bytes(r.text)).toBeLessThanOrEqual(TURN_TEXT_MAX_BYTES);
    }
    expect(records.map((r) => r.text).join('')).toBe(text);
    expect(records.some((r) => r.text.includes('...'))).toBe(false);
  });

  it('joins exactly for words, whatever the spaces and the characters', () => {
    for (const text of [words(4000), 'é'.repeat(9000), '😀'.repeat(5000), '"'.repeat(9000), 'x\n'.repeat(8000)]) {
      const records = turnRecords(said(text).outgoing!, 0);
      expect(records.length).toBeGreaterThan(1);
      for (const r of records) expect(bytes(r.text)).toBeLessThanOrEqual(TURN_TEXT_MAX_BYTES);
      expect(records.map((r) => r.text).join('')).toBe(text.trim());
      expect(records.map((r) => r.part)).toEqual(records.map((_, i) => i + 1));
      expect(new Set(records.map((r) => r.parts))).toEqual(new Set([records.length]));
    }
  });

  it('puts the picture on part 1 only, which then holds the words 600 bytes sooner', () => {
    const text = 'a'.repeat(TURN_TEXT_MAX_BYTES + 100);
    const records = turnRecords(said(text, talkLine(initialTalkLine, { type: 'attach', picture })).outgoing!, 1);
    expect(records).toHaveLength(2);
    expect(bytes(records[0].text)).toBeLessThanOrEqual(TURN_TEXT_MAX_BYTES - ATTACHMENT_ROOM_BYTES);
    expect(records.map((r) => r.text).join('')).toBe(text);
  });

  it('carries model, cut and about on part 1 only, so the Mayor reads them once', () => {
    const about = { kind: 'prompt' as const, id: 'top5', title: '/top5' };
    const line = talkLine(talkLine(said('first', initialTalkLine), { type: 'sent', at: 1 }), { type: 'cut' });
    const start = talkLine(talkLine(initialTalkLine, { type: 'setAbout', about }), { type: 'setModel', model: 'opus' });
    const records = turnRecords(said('a'.repeat(15_000), start).outgoing!, 0);
    expect(records[0]).toMatchObject({ model: 'opus', about });
    expect(records[1].about).toBeUndefined();
    expect(line.phase).toBe('idle');
  });

  it('a turn within the cap is one record with no part fields, unchanged on the wire', () => {
    const text = words(900);
    expect(bytes(text)).toBeLessThanOrEqual(TURN_TEXT_MAX_BYTES);
    const line = said(text);
    const records = turnRecords(line.outgoing!, 0);
    expect(records).toEqual([line.outgoing]);
    const wire = JSON.parse(encodeTurn(records[0]));
    expect(wire).not.toHaveProperty('part');
    expect(wire).not.toHaveProperty('parts');
    expect(wire.text).toBe(text);
  });
});

describe('part and parts on the wire', () => {
  const base = { talk: { id: 't1', turn: 2 }, text: 'middle', role: 'turn' as const };

  it('round-trips part and parts', () => {
    expect(decodeTurn(encodeTurn({ ...base, part: 2, parts: 3 }))).toMatchObject({ part: 2, parts: 3 });
  });

  it('reads a part that does not fit its parts as a whole turn', () => {
    for (const [part, parts] of [[0, 3], [4, 3], [1.5, 3], [2, 1], ['2', '3']] as const) {
      const back = decodeTurn(JSON.stringify({ ...base, part, parts }));
      expect(back).not.toHaveProperty('part');
      expect(back).not.toHaveProperty('parts');
    }
  });
});

describe('the log joins the parts of a turn', () => {
  let n = 0;
  const row = (text: string, part: number, parts: number, ts: number): MessageRow => {
    n += 1;
    return { id: `direct:${n}:0`, txid: `direct:${n}`, vout: 0, seq: n, class: 'talk', to: '03', from: '02', ts, ciphertext: '', plaintext: encodeTurn({ talk: { id: 'a', turn: 1 }, text, role: 'turn', part, parts }), direction: 'sent', read: true };
  };

  it('reads one turn from its parts, in order whatever order the rows came in', () => {
    const [talk] = talksFromRows([row('two ', 2, 3, 11), row('one ', 1, 3, 10), row('three', 3, 3, 12)]);
    expect(talk.log).toHaveLength(1);
    expect(talk.log[0].said).toBe('one two three');
    expect(talk.log[0].releasedAt).toBe(10_000);
  });
});
