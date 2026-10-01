// src/model/talkScreen.ts — what the Talk line screen keeps besides the line's own
// state machine (src/model/talkLine.ts): the turns of this talk as he sees them,
// each with his words, the Mayor's answer and how soon the first words of it came.
// Pure: the screen feeds it events with the time they happened.
import { talkLine, type TalkLineEvent, type TalkLineState } from './talkLine';

export interface TalkLogEntry {
  turn: number;
  /** His words, as the recogniser heard them. */
  said: string;
  /** His previous answer was cut off before this turn. */
  cut: boolean;
  /** The model he asked for on this turn. */
  asked?: string;
  /** When he let go of the button (ms). */
  releasedAt: number;
  /** The Mayor's latest words for this turn: a holding answer until the real one comes. */
  answer?: string;
  /** The model the answer says it came from. */
  answeredBy?: string;
  /** From his release to the first of the Mayor's words reaching the phone (ms). */
  firstWordsMs?: number;
}

export interface TalkScreenState {
  line: TalkLineState;
  log: TalkLogEntry[];
}

export interface TalkScreenAction {
  event: TalkLineEvent;
  /** When it happened (ms). */
  at: number;
}

export const initialTalkScreen = (line: TalkLineState): TalkScreenState => ({ line, log: [] });

/** "2.4 s": seconds to one decimal. */
export function formatSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

function withAnswer(log: TalkLogEntry[], turn: number, text: string, answeredBy: string | undefined, at: number): TalkLogEntry[] {
  return log.map((entry) =>
    entry.turn === turn
      ? { ...entry, answer: text, answeredBy: answeredBy ?? entry.answeredBy, firstWordsMs: entry.firstWordsMs ?? at - entry.releasedAt }
      : entry,
  );
}

export function talkScreen(state: TalkScreenState, { event, at }: TalkScreenAction): TalkScreenState {
  const line = talkLine(state.line, event);
  if (line === state.line) return state;
  let log = state.log;
  switch (event.type) {
    case 'hold':
      // A new talk starts with a clean page; speaking over a turn that failed to send gives that turn up.
      if (!state.line.talk) log = [];
      else if (state.line.unsent) log = log.slice(0, -1);
      break;
    case 'release':
      if (line.outgoing) {
        const { talk, text, cut, model } = line.outgoing;
        log = [...log, { turn: talk.turn, said: text, cut: cut === true, asked: model, releasedAt: at }];
      }
      break;
    case 'incoming':
      if (line.phase === 'speaking' && line.speaking && line.talk) log = withAnswer(log, line.talk.turn, line.speaking.text, line.answeredBy, at);
      break;
  }
  return { line, log };
}
