// The Talk line's wait, counted by a fake clock: the Mayor here is waited on for 90 s and
// reads 'thinking' from 8 s; the Mayor away is given up on at 30 s (mw-j0f2d.30).
import { describe, expect, it } from 'vitest';
import {
  initialTalkLine,
  talkLine,
  NO_ANSWER_IN_TIME,
  TALK_AWAY_TIMEOUT_MS,
  TALK_THINKING_MS,
  TALK_TIMEOUT_MS,
  type TalkLineEvent,
  type TalkLineState,
} from '../../src/model/talkLine';

const SENT_AT = 5_000;

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
  it('never says thinking, and gives up at 30 s', () => {
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
