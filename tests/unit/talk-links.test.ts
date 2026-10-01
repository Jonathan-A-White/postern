// tests/unit/talk-links.test.ts — mw-j0f2d.18: an answer's bead links ride in the turn,
// reach the log entry of its turn, and are never part of what is spoken.
import { describe, expect, it } from 'vitest';
import { decodeTurn, encodeTurn } from '../../src/services/talk';
import { initialTalkLine, type TalkLineEvent } from '../../src/model/talkLine';
import { initialTalkScreen, talkScreen, type TalkScreenState } from '../../src/model/talkScreen';

const answer = (links?: unknown) =>
  JSON.stringify({ talk: { id: 't', turn: 1 }, text: 'Three things landed.', role: 'answer', ...(links === undefined ? {} : { links }) });

function run(events: TalkLineEvent[]): TalkScreenState {
  return events.reduce((state, event, i) => talkScreen(state, { event, at: 1000 * (i + 1) }), initialTalkScreen(initialTalkLine));
}

const waiting: TalkLineEvent[] = [
  { type: 'hold', talkId: 't' },
  { type: 'release', text: 'What landed?' },
  { type: 'sent', at: 2000 },
];

describe('links on a Talk turn', () => {
  it('survive encode and decode, and stay out of a turn without any', () => {
    const turn = { talk: { id: 't', turn: 1 }, text: 'ok', role: 'answer' as const, links: ['mw-x.1', 'mw-y'] };
    expect(decodeTurn(encodeTurn(turn))).toEqual(turn);
    expect(JSON.parse(encodeTurn({ ...turn, links: undefined }))).not.toHaveProperty('links');
    expect(JSON.parse(encodeTurn({ ...turn, links: [] }))).not.toHaveProperty('links');
  });

  it('decode to only the string ids, and to none when the field is not a list', () => {
    expect(decodeTurn(answer(['mw-x.1', 7, '', 'mw-y']))?.links).toEqual(['mw-x.1', 'mw-y']);
    expect(decodeTurn(answer('mw-x.1'))).not.toHaveProperty('links');
    expect(decodeTurn(answer([]))).not.toHaveProperty('links');
  });

  it('reach the log entry of the turn, while the text spoken is the answer text alone', () => {
    const turn = decodeTurn(answer(['mw-x.1']))!;
    const state = run([...waiting, { type: 'incoming', turn }]);
    expect(state.line.speaking?.text).toBe('Three things landed.');
    expect(state.log[0].answer).toBe('Three things landed.');
    expect(state.log[0].links).toEqual(['mw-x.1']);
  });

  it('are absent on an answer that has none', () => {
    const state = run([...waiting, { type: 'incoming', turn: decodeTurn(answer())! }]);
    expect(state.log[0].links).toBeUndefined();
  });

  it('belong to the latest words: the real answer replaces a holding answer and its links', () => {
    const holding = { talk: { id: 't', turn: 1 }, text: 'One moment.', role: 'holding' as const, links: ['mw-h'] };
    const real = decodeTurn(answer(['mw-x.1']))!;
    const state = run([...waiting, { type: 'incoming', turn: holding }, { type: 'spoken' }, { type: 'incoming', turn: real }]);
    expect(state.log[0].links).toEqual(['mw-x.1']);
    const noLinks = run([...waiting, { type: 'incoming', turn: holding }, { type: 'spoken' }, { type: 'incoming', turn: decodeTurn(answer())! }]);
    expect(noLinks.log[0].links).toBeUndefined();
  });
});
