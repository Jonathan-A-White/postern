// src/model/talkLog.ts — the Talk screen's log, rebuilt from the stored `talk` rows
// (docs/protocol.md §20): every turn, his and the Mayor's, is a row of its own, so the
// screen can show the talk again after it was left or reloaded. Pure: it reads rows and
// the time it is asked at, and touches nothing.
import type { MessageRow } from '../data/db';
import { decodeTurn } from '../services/talk';
import { clockHHMM } from './call';
import { NO_ANSWER_IN_TIME, TALK_AWAY_TIMEOUT_MS, type TalkLineState, type TalkTurn } from './talkLine';
import type { TalkLogEntry } from './talkScreen';

type TalkRow = Pick<MessageRow, 'id' | 'direction' | 'ts' | 'plaintext' | 'heard'>;

/** One talk as its rows tell it: its turns and answers in order, whether it has ended, and which rows were its. */
export interface RecordedTalk {
  id: string;
  log: TalkLogEntry[];
  ended: boolean;
  /** The ids of its rows. */
  rows: string[];
  /** The row of the real answer to the last turn, when it has one. */
  lastAnswerRow?: string;
}

/** The open talk: what the screen starts from. */
export interface OpenTalk extends RecordedTalk {
  /** The line as it stands: idle, waiting for the Mayor, or about to speak an answer he never heard. */
  line: TalkLineState;
  /** The row of the answer that waits to be spoken, when the last answer was never heard. */
  unheardRow?: string;
}

interface Accumulated {
  id: string;
  rows: string[];
  ended: boolean;
  lastTs: number;
  lastIndex: number;
  his: Map<number, { turn: TalkTurn; ts: number }>;
  answers: Map<number, { turn: TalkTurn; ts: number; row: string; heard?: boolean; firstTs: number }>;
}

function entryOf(talk: Accumulated, number: number): TalkLogEntry | undefined {
  const his = talk.his.get(number);
  if (!his) return undefined;
  const { turn, ts } = his;
  const entry: TalkLogEntry = { turn: number, said: turn.text, cut: turn.cut === true, asked: turn.model, releasedAt: ts * 1000 };
  const answer = talk.answers.get(number);
  if (!answer) return entry;
  entry.answer = answer.turn.text;
  entry.answered = answer.turn.role === 'answer';
  if (answer.turn.links?.length) entry.links = answer.turn.links;
  entry.answeredBy = answer.turn.model;
  entry.firstWordsMs = Math.max(0, (answer.firstTs - ts) * 1000);
  if (entry.answered && answer.heard !== undefined) entry.heard = answer.heard;
  return entry;
}

/**
 * The talks the rows hold, oldest first (by their newest row), each with its log in turn
 * order whatever order the rows came in. A row that is not a readable turn is left out, and
 * so is an answer to a turn of his that has no row.
 */
export function talksFromRows(rows: TalkRow[]): RecordedTalk[] {
  const byId = new Map<string, Accumulated>();
  rows.forEach((row, index) => {
    const turn = decodeTurn(row.plaintext);
    if (!turn) return;
    let talk = byId.get(turn.talk.id);
    if (!talk) {
      talk = { id: turn.talk.id, rows: [], ended: false, lastTs: row.ts, lastIndex: index, his: new Map(), answers: new Map() };
      byId.set(turn.talk.id, talk);
    }
    talk.rows.push(row.id);
    if (row.ts >= talk.lastTs) {
      talk.lastTs = row.ts;
      talk.lastIndex = index;
    }
    if (turn.role === 'end') talk.ended = true;
    else if (row.direction === 'sent' && turn.role === 'turn') talk.his.set(turn.talk.turn, { turn, ts: row.ts });
    else if (row.direction === 'received' && (turn.role === 'answer' || turn.role === 'holding')) {
      const before = talk.answers.get(turn.talk.turn);
      // A real answer is never replaced by a holding one; of two of a kind the later row wins.
      if (before?.turn.role === 'answer' && turn.role === 'holding') {
        before.firstTs = Math.min(before.firstTs, row.ts);
        return;
      }
      talk.answers.set(turn.talk.turn, { turn, ts: row.ts, row: row.id, heard: row.heard, firstTs: Math.min(before?.firstTs ?? row.ts, row.ts) });
    }
  });
  return [...byId.values()]
    .sort((a, b) => a.lastTs - b.lastTs || a.lastIndex - b.lastIndex)
    .map((talk) => {
      const numbers = [...talk.his.keys()].sort((a, b) => a - b);
      const log = numbers.map((number) => entryOf(talk, number)!);
      const lastAnswer = numbers.length ? talk.answers.get(numbers[numbers.length - 1]) : undefined;
      return { id: talk.id, log, ended: talk.ended, rows: talk.rows, ...(lastAnswer?.turn.role === 'answer' ? { lastAnswerRow: lastAnswer.row } : {}) };
    });
}

/**
 * The open talk, the one place that says which it is: the newest talk, unless it has ended
 * (he tapped End, or the Mayor ended it). The quiet spell after an unanswered turn does not end a
 * talk today (the line only stops waiting), so it does not here either. `nowMs` is when the
 * screen is built: a last turn that has waited past the line's own give-up time shows that it did.
 */
export function openTalk(rows: TalkRow[], nowMs: number): OpenTalk | undefined {
  const talk = talksFromRows(rows).at(-1);
  if (!talk || talk.ended || talk.log.length === 0) return undefined;
  const last = talk.log[talk.log.length - 1];
  const base: TalkLineState = { phase: 'idle', talk: { id: talk.id, turn: last.turn }, cutPending: false, model: last.asked, answeredBy: last.answeredBy };
  if (last.answered) {
    if (last.heard !== false) return { ...talk, line: base };
    const speaking = { text: last.answer ?? '', holding: false, ...(last.links ? { links: last.links } : {}) };
    return { ...talk, line: { ...base, phase: 'speaking', speaking }, unheardRow: talk.lastAnswerRow };
  }
  if (nowMs - last.releasedAt >= TALK_AWAY_TIMEOUT_MS) return { ...talk, line: { ...base, error: NO_ANSWER_IN_TIME } };
  return { ...talk, line: { ...base, phase: 'waiting', sentAt: last.releasedAt, thinking: false, mayorHere: false } };
}

/** An earlier talk as the screen lists it above the open one. */
export interface EarlierTalk {
  id: string;
  /** When he let go of the button on its first turn (ms). */
  startedAt: number;
  log: TalkLogEntry[];
}

/** How many earlier talks the screen shows at a time, and adds with each scroll up. */
export const EARLIER_PAGE = 5;

/**
 * The talks before the open one, oldest first: every talk the rows hold that has a turn of his,
 * except `exceptId` (the talk the screen is showing as its own).
 */
export function earlierTalks(rows: TalkRow[], exceptId: string | undefined): EarlierTalk[] {
  return talksFromRows(rows)
    .filter((talk) => talk.id !== exceptId && talk.log.length > 0)
    .map((talk) => ({ id: talk.id, startedAt: talk.log[0].releasedAt, log: talk.log }));
}

/** The words of a talk's divider: the day and the time of day it began, "Thu, Oct 1, 14:05". */
export function talkDividerLabel(startedAtMs: number): string {
  const day = new Date(startedAtMs).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day}, ${clockHHMM(startedAtMs / 1000)}`;
}
