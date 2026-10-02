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
  /** The Mayor's real answer has come (a holding answer does not count). */
  answered?: boolean;
  /** Bead ids the latest answer points at, shown as chips and never spoken. */
  links?: string[];
  /** The model the answer says it came from. */
  answeredBy?: string;
  /** From his release to the first of the Mayor's words reaching the phone (ms). */
  firstWordsMs?: number;
  /** False while the real answer has not been played to its end or stopped by him; true once it has; unknown (absent) for an answer spoken as it came. */
  heard?: boolean;
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

/** The open talk read back from the stored rows (src/model/talkLog.ts), to start the screen from. */
export interface TalkSeed {
  seed: { line: TalkLineState; log: TalkLogEntry[] };
}

export const initialTalkScreen = (line: TalkLineState): TalkScreenState => ({ line, log: [] });

/** "2.4 s": seconds to one decimal. */
export function formatSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

/** The 'cut the last answer' tag stays on a turn that cut an answer only until the Mayor's next answer arrives. */
export function showsCutTag(entry: Pick<TalkLogEntry, 'cut' | 'answered'>): boolean {
  return entry.cut && entry.answered !== true;
}

function withAnswer(log: TalkLogEntry[], turn: number, speaking: { text: string; holding: boolean; links?: string[] }, answeredBy: string | undefined, at: number): TalkLogEntry[] {
  return log.map((entry) =>
    entry.turn === turn
      ? {
          ...entry,
          answer: speaking.text,
          links: speaking.links,
          answered: entry.answered === true || !speaking.holding,
          answeredBy: answeredBy ?? entry.answeredBy,
          firstWordsMs: entry.firstWordsMs ?? at - entry.releasedAt,
        }
      : entry,
  );
}

/** True while the line is speaking a real answer (a holding one is followed by the real one). */
const speakingAnswer = (line: TalkLineState): boolean => line.phase === 'speaking' && line.speaking?.holding === false;

/** What the screen's reducer takes: an event of the line, or the open talk to start from. */
export function talkScreenReducer(state: TalkScreenState, action: TalkScreenAction | TalkSeed): TalkScreenState {
  if (!('seed' in action)) return talkScreen(state, action);
  // Only a screen that has no talk yet starts from one; a talk he already began wins.
  if (state.line.talk || state.line.phase !== 'idle') return state;
  const { line, log } = action.seed;
  return { line: { ...line, about: state.line.about, model: state.line.model ?? line.model }, log };
}

export function talkScreen(state: TalkScreenState, { event, at }: TalkScreenAction): TalkScreenState {
  const line = talkLine(state.line, event);
  if (line === state.line) return state;
  let log = state.log;
  // The answer being spoken is heard once the line moves off it: it finished, or he stopped it.
  const turn = state.line.talk?.turn;
  const played = speakingAnswer(state.line) && !state.line.speaking?.unspoken && !(speakingAnswer(line) && !line.speaking?.unspoken);
  if (played && turn !== undefined) log = log.map((entry) => (entry.turn === turn && entry.heard === false ? { ...entry, heard: true } : entry));
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
      if (line.phase === 'speaking' && line.speaking && line.talk) log = withAnswer(log, line.talk.turn, line.speaking, line.answeredBy, at);
      break;
  }
  return { line, log };
}
