// The 'cut the last answer' tag (mw-j0f2d.22): it stays on a turn that cut an answer only
// until the Mayor's next answer arrives. A holding answer ("One moment.") is not that answer.
import { describe, expect, it } from 'vitest';
import { initialTalkLine, type TalkTurn } from '../../src/model/talkLine';
import { initialTalkScreen, showsCutTag, talkScreen, type TalkScreenState } from '../../src/model/talkScreen';

const feed = (state: TalkScreenState, event: Parameters<typeof talkScreen>[1]['event'], at = 1000) => talkScreen(state, { event, at });
const mayor = (turn: number, role: TalkTurn['role'], text: string): TalkTurn => ({ talk: { id: 't', turn }, text, role });

describe('showsCutTag', () => {
  it('shows on a turn that cut an answer and has none yet', () => {
    expect(showsCutTag({ cut: true })).toBe(true);
    expect(showsCutTag({ cut: true, answered: false })).toBe(true);
  });
  it('is gone once the Mayor has answered', () => {
    expect(showsCutTag({ cut: true, answered: true })).toBe(false);
  });
  it('never shows on a turn that cut nothing', () => {
    expect(showsCutTag({ cut: false })).toBe(false);
  });
});

describe('the log across a cut', () => {
  function cutThenSecondTurn(): TalkScreenState {
    let s = initialTalkScreen(initialTalkLine);
    s = feed(s, { type: 'hold', talkId: 't' });
    s = feed(s, { type: 'release', text: 'Tell me' });
    s = feed(s, { type: 'sent', at: 1000 });
    s = feed(s, { type: 'incoming', turn: mayor(1, 'answer', 'Long answer') });
    s = feed(s, { type: 'cut' });
    s = feed(s, { type: 'hold', talkId: 't' });
    s = feed(s, { type: 'release', text: 'Skip that' });
    return feed(s, { type: 'sent', at: 2000 }, 2000);
  }

  it('carries the cut on his second turn until the real answer arrives', () => {
    const s = cutThenSecondTurn();
    expect(s.log).toHaveLength(2);
    expect(showsCutTag(s.log[1])).toBe(true);
  });

  it('keeps the tag through a holding answer', () => {
    const s = feed(cutThenSecondTurn(), { type: 'incoming', turn: mayor(2, 'holding', 'One moment.') }, 2500);
    expect(s.log[1].answer).toBe('One moment.');
    expect(showsCutTag(s.log[1])).toBe(true);
  });

  it('drops the tag when the real answer arrives, even after a holding one', () => {
    let s = feed(cutThenSecondTurn(), { type: 'incoming', turn: mayor(2, 'holding', 'One moment.') }, 2500);
    s = feed(s, { type: 'spoken' }, 2600);
    s = feed(s, { type: 'incoming', turn: mayor(2, 'answer', 'Skipped.') }, 3000);
    expect(showsCutTag(s.log[1])).toBe(false);
    expect(showsCutTag(s.log[0])).toBe(false);
  });
});
