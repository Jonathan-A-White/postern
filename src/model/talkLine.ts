// src/model/talkLine.ts — the Talk line (docs/protocol.md §20) as a pure state
// machine: idle, listening (the button is held), sending, waiting (his turn is
// sent, the Mayor has not answered), speaking, then idle again. A screen feeds it
// events and does what the state asks (record, send `outgoing`, speak
// `speaking`); the machine itself touches nothing. A talk is one run of turns under
// one id; the model he picked lasts as long as the talk does.

/** The turn plaintext of §20: what `ct` seals. */
export type TalkRole = 'turn' | 'answer' | 'holding' | 'end';

export interface TalkTurn {
  talk: { id: string; turn: number };
  text: string;
  role: TalkRole;
  /** The model the Mayor's answers should use from this turn on, or the one that answered. */
  model?: string;
  /** True on a turn whose previous answer he cut off before it finished speaking. */
  cut?: boolean;
  /** Bead ids an answer points at: shown as chips under its text, never spoken. */
  links?: string[];
}

export type TalkPhase = 'idle' | 'listening' | 'sending' | 'waiting' | 'speaking';

export interface TalkLineState {
  phase: TalkPhase;
  /** The current talk: its id and the number of the last turn he made (or is making). */
  talk?: { id: string; turn: number };
  /** The model chosen for this talk; absent means the Mayor's own choice. */
  model?: string;
  /** The model the last answer says it came from. */
  answeredBy?: string;
  /** His last answer was cut off: the next turn says so. */
  cutPending: boolean;
  /** The turn waiting to be sent, while `sending`. */
  outgoing?: TalkTurn;
  /** When his turn went out (ms), while `waiting`; a holding answer does not reset it. */
  sentAt?: number;
  /** What is being spoken; `holding` ones are followed by the real answer. */
  speaking?: { text: string; holding: boolean; links?: string[] };
  /** Why the line went back to idle without an answer. */
  error?: string;
  /** The turn that failed to send, kept with his words so `retry` can send it again. */
  unsent?: TalkTurn;
}

export type TalkLineEvent =
  | { type: 'hold'; talkId: string }
  | { type: 'release'; text: string }
  | { type: 'cancel' }
  | { type: 'sent'; at: number }
  | { type: 'sendFailed'; message?: string }
  | { type: 'retry' }
  | { type: 'incoming'; turn: TalkTurn }
  | { type: 'spoken' }
  | { type: 'cut' }
  | { type: 'tick'; now: number }
  | { type: 'setModel'; model?: string }
  | { type: 'end' };

/** How long the line waits for an answer; the aim is about 8 s, so this is generous. */
export const TALK_TIMEOUT_MS = 30_000;
export const NO_ANSWER_IN_TIME = 'The Mayor did not answer in time.';
export const COULD_NOT_SEND = 'Could not send. Try again.';

/**
 * The most of one turn's words the line sends, as the bytes the text takes inside the turn's
 * JSON (an escaped quote counts two). A record's payload may be at most 10,240 bytes
 * (spell-forge-bsv's encodeRecordScript throws past it, which was the 'Could not send' of
 * mw-j0f2d.15): the envelope, the BRC-78 header and base64 leave room for about 7,250 bytes
 * of turn JSON, whose own fields take a hundred and some. 7,000 keeps a margin; it is about
 * 1,100 spoken words, several minutes of talk. A turn over it is cut and ends with "...".
 */
export const TURN_TEXT_MAX_BYTES = 7_000;

const CUT_MARK = '...';

/** The bytes `ch` takes inside a JSON string. */
function jsonBytes(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (ch === '"' || ch === '\\') return 2;
  if (code < 0x20) return code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : 6;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code >= 0xd800 && code <= 0xdfff) return 6; // a lone surrogate is written \uXXXX
  return code < 0x10000 ? 3 : 4;
}

/** `text` as it is when it fits `maxBytes` (as JSON writes it), otherwise cut there, on a whole character, and ended with "...". */
export function capText(text: string, maxBytes: number): string {
  let size = 0;
  for (const ch of text) size += jsonBytes(ch);
  if (size <= maxBytes) return text;
  const room = maxBytes - CUT_MARK.length;
  let kept = '';
  size = 0;
  for (const ch of text) {
    size += jsonBytes(ch);
    if (size > room) break;
    kept += ch;
  }
  return kept.trimEnd() + CUT_MARK;
}

/** His turn's words, cut at the turn cap. */
export const capTurnText = (text: string): string => capText(text, TURN_TEXT_MAX_BYTES);

export const initialTalkLine: TalkLineState = { phase: 'idle', cutPending: false };

function idle(state: TalkLineState, patch: Partial<TalkLineState> = {}): TalkLineState {
  return {
    phase: 'idle',
    talk: state.talk,
    model: state.model,
    answeredBy: state.answeredBy,
    cutPending: state.cutPending,
    ...patch,
  };
}

const linksOf = (turn: TalkTurn): { links?: string[] } => (turn.links?.length ? { links: turn.links } : {});

function incoming(state: TalkLineState, turn: TalkTurn): TalkLineState {
  if (!state.talk || turn.talk.id !== state.talk.id) return state;
  if (turn.role === 'end') return talkLine(state, { type: 'end' });
  if (turn.talk.turn !== state.talk.turn) return state;
  const answering = state.phase === 'waiting' || (state.phase === 'speaking' && state.speaking?.holding === true);
  if (turn.role === 'answer' && answering) {
    return { ...state, phase: 'speaking', speaking: { text: turn.text, holding: false, ...linksOf(turn) }, answeredBy: turn.model ?? state.answeredBy, error: undefined };
  }
  if (turn.role === 'holding' && state.phase === 'waiting') {
    return { ...state, phase: 'speaking', speaking: { text: turn.text, holding: true, ...linksOf(turn) }, answeredBy: turn.model ?? state.answeredBy };
  }
  return state;
}

/** The next state for `event`; an event that means nothing in `state` returns `state` itself. */
export function talkLine(state: TalkLineState, event: TalkLineEvent): TalkLineState {
  switch (event.type) {
    case 'hold': {
      if (state.phase === 'waiting' || state.phase === 'sending' || state.phase === 'listening') return state;
      // Holding the button over a spoken answer cuts it off.
      const cutPending = state.cutPending || state.phase === 'speaking';
      // Speaking again gives up the turn that failed: its number goes back to him.
      const base = state.unsent ? { ...state, talk: state.unsent.talk.turn > 1 ? { id: state.unsent.talk.id, turn: state.unsent.talk.turn - 1 } : undefined, unsent: undefined } : state;
      return { ...base, phase: 'listening', talk: base.talk ?? { id: event.talkId, turn: 0 }, cutPending, speaking: undefined, error: undefined };
    }
    case 'release': {
      if (state.phase !== 'listening' || !state.talk) return state;
      const text = capTurnText(event.text.trim());
      if (!text) return idle(state, { talk: state.talk.turn > 0 ? state.talk : undefined });
      const talk = { id: state.talk.id, turn: state.talk.turn + 1 };
      const outgoing: TalkTurn = { talk, text, role: 'turn', ...(state.model ? { model: state.model } : {}), ...(state.cutPending ? { cut: true } : {}) };
      return { ...state, phase: 'sending', talk, outgoing };
    }
    case 'cancel':
      if (state.phase !== 'listening') return state;
      return idle(state, { talk: state.talk && state.talk.turn > 0 ? state.talk : undefined });
    case 'sent':
      if (state.phase !== 'sending') return state;
      return { ...state, phase: 'waiting', outgoing: undefined, unsent: undefined, sentAt: event.at, cutPending: false };
    case 'sendFailed': {
      // His words stay: `retry` sends this very turn again, under the same number.
      if (state.phase !== 'sending' || !state.talk || !state.outgoing) return state;
      return idle(state, { unsent: state.outgoing, error: event.message ?? COULD_NOT_SEND });
    }
    case 'retry':
      if (state.phase !== 'idle' || !state.unsent) return state;
      return { ...state, phase: 'sending', outgoing: { ...state.unsent }, unsent: undefined, error: undefined };
    case 'incoming':
      return incoming(state, event.turn);
    case 'spoken':
      if (state.phase !== 'speaking') return state;
      return state.speaking?.holding ? { ...state, phase: 'waiting', speaking: undefined } : idle(state);
    case 'cut':
      if (state.phase === 'speaking') return idle(state, { cutPending: true });
      if (state.phase === 'waiting') return idle(state);
      return state;
    case 'tick':
      if (state.phase !== 'waiting' || state.sentAt === undefined || event.now - state.sentAt < TALK_TIMEOUT_MS) return state;
      return idle(state, { error: NO_ANSWER_IN_TIME });
    case 'setModel':
      return { ...state, model: event.model };
    case 'end':
      return { phase: 'idle', cutPending: false };
  }
}

/** The turn that ends the talk, for him to send; `undefined` when there is no talk. */
export function endTurn(state: TalkLineState): TalkTurn | undefined {
  return state.talk ? { talk: state.talk, text: '', role: 'end' } : undefined;
}
