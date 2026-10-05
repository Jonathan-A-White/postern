// The Talk line's wait, counted by a fake clock: the Mayor here is waited on for 90 s and
// reads 'thinking' from 8 s; the Mayor away is given up on at 60 s (mw-j0f2d.30, mw-am3yjh.5);
// an answer that lands after the give-up is still taken (mw-am3yjh.5).
import { describe, expect, it } from 'vitest';
import { initialTalkScreen, talkScreen } from '../../src/model/talkScreen';
import {
  initialTalkLine,
  isLateAnswer,
  talkLine,
  NO_ANSWER_IN_TIME,
  TALK_AWAY_TIMEOUT_MS,
  TALK_THINKING_MS,
  TALK_TIMEOUT_MS,
  type TalkLineEvent,
  type TalkLineState,
} from '../../src/model/talkLine';

const SENT_AT = 5_000;

describe('the Talk line wait window', () => {
  it('is at least 60 s whether the Mayor is here or away', () => {
    expect(TALK_AWAY_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
    expect(TALK_TIMEOUT_MS).toBeGreaterThanOrEqual(TALK_AWAY_TIMEOUT_MS);
  });

  it('does not say the Mayor did not answer, since one may be on its way', () => {
    expect(NO_ANSWER_IN_TIME).not.toMatch(/did not answer/i);
    expect(NO_ANSWER_IN_TIME).toMatch(/will play/);
  });
});

function waiting(here?: boolean): TalkLineState {
  const events: TalkLineEvent[] = [
    { type: 'hold', talkId: 't1' },
    { type: 'release', text: 'Hello' },
    { type: 'sent', at: SENT_AT, here },
  ];
  return events.reduce(talkLine, initialTalkLine);
}

/** The line after ticking once a second from the send until `ms` have been waited. */
function waitedFor(start: TalkLineState, ms: number, here?: (waited: number) => boolean | undefined): TalkLineState {
  let state = start;
  for (let waited = 1_000; waited <= ms; waited += 1_000) {
    state = talkLine(state, { type: 'tick', now: SENT_AT + waited, here: here?.(waited) });
  }
  return state;
}

describe('the Talk line wait with the Mayor here', () => {
  it('says thinking only once 8 s have passed', () => {
    expect(waitedFor(waiting(true), TALK_THINKING_MS - 1_000).thinking).toBeFalsy();
    expect(waitedFor(waiting(true), TALK_THINKING_MS).thinking).toBe(true);
  });

  it('is still waiting just before 90 s and gives up at 90 s', () => {
    expect(waitedFor(waiting(true), TALK_TIMEOUT_MS - 1_000).phase).toBe('waiting');
    const gaveUp = waitedFor(waiting(true), TALK_TIMEOUT_MS);
    expect(gaveUp.phase).toBe('idle');
    expect(gaveUp.error).toBe(NO_ANSWER_IN_TIME);
  });

  it('counts him as here when the poll says so only after the turn went out', () => {
    const state = waitedFor(waiting(false), 60_000, () => true);
    expect(state.phase).toBe('waiting');
    expect(state.thinking).toBe(true);
  });

  it('stays on the long wait when his wait drops while he thinks', () => {
    const state = waitedFor(waiting(true), 60_000, () => false);
    expect(state.phase).toBe('waiting');
    expect(state.thinking).toBe(true);
  });
});

describe('the Talk line wait with the Mayor away', () => {
  it('never says thinking, and gives up at 60 s', () => {
    for (const start of [waiting(false), waiting(undefined)]) {
      expect(waitedFor(start, TALK_AWAY_TIMEOUT_MS - 1_000).phase).toBe('waiting');
      expect(waitedFor(start, TALK_AWAY_TIMEOUT_MS - 1_000).thinking).toBeFalsy();
      const gaveUp = waitedFor(start, TALK_AWAY_TIMEOUT_MS);
      expect(gaveUp.phase).toBe('idle');
      expect(gaveUp.error).toBe(NO_ANSWER_IN_TIME);
    }
  });
});

describe('a late answer after the give-up', () => {
  it('replaces the give-up line', () => {
    const gaveUp = waitedFor(waiting(false), TALK_AWAY_TIMEOUT_MS);
    const late = talkLine(gaveUp, { type: 'incoming', turn: { talk: { id: 't1', turn: 1 }, text: 'Late.', role: 'answer' } });
    expect(late.phase).toBe('speaking');
    expect(late.speaking?.text).toBe('Late.');
    expect(late.error).toBeUndefined();
  });
});

const answerTo = (turn: number, text = 'Late.') => ({ type: 'incoming', turn: { talk: { id: 't1', turn }, text, role: 'answer' } }) as const;

/** Turn 1 unanswered past the window, then turn 2 sent. */
function onNextTurn(): TalkLineState {
  const gaveUp = waitedFor(waiting(false), TALK_AWAY_TIMEOUT_MS);
  const events: TalkLineEvent[] = [{ type: 'hold', talkId: 't1' }, { type: 'release', text: 'Did you get that?' }, { type: 'sent', at: SENT_AT + TALK_AWAY_TIMEOUT_MS + 5_000 }];
  return events.reduce(talkLine, gaveUp);
}

describe('an answer to an earlier turn once he has gone on', () => {
  it('is a late answer, not an answer to the turn being waited on', () => {
    const state = onNextTurn();
    expect(isLateAnswer(state, answerTo(1).turn)).toBe(true);
    expect(isLateAnswer(state, answerTo(2).turn)).toBe(false);
    expect(isLateAnswer(state, { ...answerTo(1).turn, talk: { id: 'other', turn: 1 } })).toBe(false);
    expect(isLateAnswer(state, { ...answerTo(1).turn, role: 'holding' })).toBe(false);
  });

  it('leaves the line alone while it is busy', () => {
    const state = onNextTurn();
    expect(talkLine(state, answerTo(1))).toBe(state);
  });

  it('is spoken when the line is idle, and the turn it answers is named', () => {
    const idleAgain = talkLine(onNextTurn(), { type: 'cut' });
    const late = talkLine(idleAgain, answerTo(1));
    expect(late.phase).toBe('speaking');
    expect(late.speaking).toMatchObject({ text: 'Late.', holding: false, turn: 1 });
    expect(talkLine(late, { type: 'spoken' }).phase).toBe('idle');
  });

  it('is shown on the turn it answers in the log, marked not heard, with how long it took', () => {
    const at = SENT_AT + TALK_AWAY_TIMEOUT_MS + 20_000;
    const events = [
      { event: { type: 'hold', talkId: 't1' }, at: 0 },
      { event: { type: 'release', text: 'Hello' }, at: SENT_AT },
      { event: { type: 'sent', at: SENT_AT }, at: SENT_AT },
      { event: { type: 'tick', now: SENT_AT + TALK_AWAY_TIMEOUT_MS }, at: SENT_AT + TALK_AWAY_TIMEOUT_MS },
      { event: { type: 'hold', talkId: 't1' }, at: SENT_AT + 61_000 },
      { event: { type: 'release', text: 'Again' }, at: SENT_AT + 62_000 },
      { event: { type: 'sent', at: SENT_AT + 62_000 }, at: SENT_AT + 62_000 },
      { event: answerTo(1), at },
    ] as const;
    const state = events.reduce((acc, action) => talkScreen(acc, action as never), initialTalkScreen(initialTalkLine));
    expect(state.line.phase).toBe('waiting');
    expect(state.log[0]).toMatchObject({ answer: 'Late.', answered: true, heard: false, tookMs: at - SENT_AT });
    expect(state.log[1].answer).toBeUndefined();
  });
});

describe('an answer to the line\'s own turn after its wait is over (mw-am3yjh.6)', () => {
  const gaveUp = () => waitedFor(waiting(false), TALK_AWAY_TIMEOUT_MS);

  it('is the answer the line wants while it waits or has just given up', () => {
    expect(isLateAnswer(waiting(false), answerTo(1).turn)).toBe(false);
    expect(isLateAnswer(gaveUp(), answerTo(1).turn)).toBe(false);
  });

  it('is late once he held the button after the give-up and let go with no words', () => {
    const state = [{ type: 'hold', talkId: 't1' }, { type: 'cancel' }].reduce<TalkLineState>((acc, event) => talkLine(acc, event as TalkLineEvent), gaveUp());
    expect(state.phase).toBe('idle');
    expect(state.error).toBeUndefined();
    expect(isLateAnswer(state, answerTo(1).turn)).toBe(true);
    const spoken = talkLine(state, answerTo(1));
    expect(spoken.phase).toBe('speaking');
    expect(spoken.speaking).toMatchObject({ text: 'Late.', holding: false, turn: 1 });
  });

  it('is late, and left to the log, while he holds the button', () => {
    const state = talkLine(gaveUp(), { type: 'hold', talkId: 't1' });
    expect(state.phase).toBe('listening');
    expect(isLateAnswer(state, answerTo(1).turn)).toBe(true);
    expect(talkLine(state, answerTo(1))).toBe(state);
  });

  it('is shown in the log, not heard yet, when it lands while he holds the button', () => {
    const at = SENT_AT + TALK_AWAY_TIMEOUT_MS + 20_000;
    const events = [
      { event: { type: 'hold', talkId: 't1' }, at: 0 },
      { event: { type: 'release', text: 'Hello' }, at: SENT_AT },
      { event: { type: 'sent', at: SENT_AT }, at: SENT_AT },
      { event: { type: 'tick', now: SENT_AT + TALK_AWAY_TIMEOUT_MS }, at: SENT_AT + TALK_AWAY_TIMEOUT_MS },
      { event: { type: 'hold', talkId: 't1' }, at: SENT_AT + 61_000 },
      { event: answerTo(1), at },
    ] as const;
    const state = events.reduce((acc, action) => talkScreen(acc, action as never), initialTalkScreen(initialTalkLine));
    expect(state.line.phase).toBe('listening');
    expect(state.log[0]).toMatchObject({ answer: 'Late.', answered: true, heard: false, tookMs: at - SENT_AT });
  });

  it('is not late while its own turn is being sent: it waits for the send to be acknowledged', () => {
    const sending = [{ type: 'hold', talkId: 't1' }, { type: 'release', text: 'Hello' }].reduce<TalkLineState>((acc, event) => talkLine(acc, event as TalkLineEvent), initialTalkLine);
    expect(sending.phase).toBe('sending');
    expect(isLateAnswer(sending, answerTo(1).turn)).toBe(false);
  });
});
