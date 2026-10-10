// src/model/needs.ts — which needs still wait on the Governor (plans/0021
// decision 8). One he has answered or acted on since it was raised leaves the
// queue at once, before the Mayor's host has applied it and the view drops it.
import type { AnswerRow, MessageRow, OutboxRow } from '../data/db';
import { decodeReply } from '../services/questions';
import { decodeThreadedMessage } from '../services/threads';
import { isEpic, type ViewIndex } from './tree';
import type { QuestionBody } from '../services/questions';
import type { BeadComment, Need, WaitsFor } from './view';

export function unsettledNeeds(needs: Need[], answers: AnswerRow[]): Need[] {
  const answered = new Map(answers.map((row) => [row.bead, row.ts * 1000]));
  return needs.filter((need) => {
    const at = answered.get(need.bead);
    // A bead waiting on others keeps its line whatever he tapped on it since (it is not a card he answers); the view drops it.
    if (at === undefined || !need.bead || need.kind === 'waiting') return true;
    const since = Date.parse(need.since);
    return !Number.isNaN(since) && since > at;
  });
}

/** Whose turn a card is: what the view says, else the factory's when it is not ready, else his. */
export function waitsFor(need: Need): WaitsFor {
  return need.waits_for ?? (need.not_ready ? 'factory' : 'you');
}

/** The unsettled needs split by whose turn they are. */
export function needsByWaiter(needs: Need[]): Record<WaitsFor, Need[]> {
  const split: Record<WaitsFor, Need[]> = { you: [], mayor: [], factory: [], others: [] };
  for (const need of needs) split[waitsFor(need)].push(need);
  return split;
}

/** A stale need (docs/protocol.md §11) always offers Keep then Close. */
export const STALE_OPTIONS = ['Keep', 'Close'];

/** A chase need (docs/protocol.md §11) always offers Chase, Done and Keep waiting, as the three actions of §13. */
export const CHASE_OPTIONS = ['Chase', 'Done', 'Keep waiting'];

/** The §13 action each of the chase need's answers sends. */
export const CHASE_ACTIONS: Record<string, string> = { Chase: 'chase', Done: 'ask_done', 'Keep waiting': 'keep_waiting' };

/** The recommended answer first, then the rest in the Mayor's order. */
export function orderedOptions(need: Need): string[] {
  const options = need.kind === 'hands' ? ['Done'] : need.kind === 'demo' ? ['Looks good'] : need.kind === 'stale' ? [...STALE_OPTIONS] : need.kind === 'chase' ? [...CHASE_OPTIONS] : [...need.options];
  if (!need.recommended || !options.includes(need.recommended)) return options;
  return [need.recommended, ...options.filter((option) => option !== need.recommended)];
}

/** One thing a card waits on: its title, and the bead's page when the view knows which bead it is. */
export interface WaitsOn {
  title: string;
  href?: string;
}

/** What a not_ready card waits on (§11's `waiting_on` titles), each linked to the open blocker of that title. */
export function waitsOnLinks(need: Need, index: ViewIndex | undefined, hrefOf: (id: string) => string): WaitsOn[] {
  const blockers = (index?.byId.get(need.bead)?.waits ?? []).map((id) => index?.byId.get(id)).filter((bead) => bead !== undefined);
  return (need.waiting_on ?? []).map((title) => {
    const blocker = blockers.find((bead) => bead.title === title);
    return blocker ? { title, href: hrefOf(blocker.id) } : { title };
  });
}

/** Whether any story under this bead is held (deferred), at any depth. */
function holdsStories(id: string, index: ViewIndex, seen = new Set<string>()): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  return (index.children.get(id) ?? []).some((child) => child.status === 'deferred' || holdsStories(child.id, index, seen));
}

/**
 * Whether a release card still has something to release, or what it already is: 'held' (or
 * 'unknown', which offers Release as before), 'building', 'released', or 'empty' (an epic with no
 * stories yet). A story is held when it is
 * deferred; an epic (protocol §11: the approve need's bead) when a story under it is. `status` is the
 * bead page's own fresher status, used for a story when given, else the view's.
 */
export function releaseState(need: Need, index?: ViewIndex, status?: string): 'held' | 'building' | 'released' | 'empty' | 'unknown' {
  const bead = index?.byId.get(need.bead);
  if (bead && index && isEpic(bead, index)) {
    if (holdsStories(bead.id, index)) return 'held';
    return (index.children.get(bead.id)?.length ?? 0) === 0 ? 'empty' : 'released';
  }
  const now = status ?? bead?.status ?? '';
  if (now === '') return 'unknown';
  if (now === 'deferred') return 'held';
  return now === 'in_progress' ? 'building' : 'released';
}

/** What he answered a question and when (ms), for the card's 'Answered' line. */
export interface SaidAnswer {
  label: string;
  at: number;
}

const ANSWER_COMMENT = /^answer\b/i;
const ANSWER_AFTER_TXID = /^answer\b.*?\btxid\s+\S+:\s+/is;

/** The ANSWER comment the factory wrote on the bead for this question (`ANSWER <ts> from <key>, txid <txid>: <answer>`),
 * made after it was asked: the answer reached the factory, whichever way it was sent. */
export function answeredByComment(need: Need, comments: BeadComment[]): SaidAnswer | undefined {
  const since = Date.parse(need.since);
  for (const comment of comments) {
    if (!ANSWER_COMMENT.test(comment.text.trim())) continue;
    const at = Date.parse(comment.at);
    if (Number.isNaN(at) || (!Number.isNaN(since) && at < since)) continue;
    const text = comment.text.trim();
    const words = ANSWER_AFTER_TXID.test(text) ? text.replace(ANSWER_AFTER_TXID, '') : text.replace(/^answer\b[\s:-]*/i, '');
    return { label: words.trim().split('\n')[0], at };
  }
  return undefined;
}

const EDGE_BEFORE = '(^|[^\\p{L}\\p{N}])';
const EDGE_AFTER = '($|[^\\p{L}\\p{N}])';
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where in `text` the regex first matches, past its leading edge character; -1 when it does not. */
function indexOfWord(text: string, pattern: string, flags: string): number {
  const found = new RegExp(pattern, flags).exec(text);
  return found ? found.index + found[1].length : -1;
}

/** Where `text` names `words` as a whole word run (any case); -1 when it does not. */
function wholeAt(text: string, words: string): number {
  const word = words.trim().toLowerCase();
  return word === '' ? -1 : indexOfWord(text.toLowerCase(), `${EDGE_BEFORE}${escapeRegExp(word)}${EDGE_AFTER}`, 'u');
}

/**
 * Where `text` names a lettered option ('A: It greyed out') by its letter; -1 when it does not. The letter names it
 * standing alone in uppercase ('Do A', 'A please'), or in any case right after do / option / pick / choose / go with /
 * answer; a lowercase lone 'a' elsewhere is the article.
 */
function letterAt(text: string, option: string): number {
  const letter = /^\s*(\p{L})\s*:/u.exec(option)?.[1];
  if (letter === undefined) return -1;
  const capital = indexOfWord(text, `${EDGE_BEFORE}${escapeRegExp(letter.toUpperCase())}${EDGE_AFTER}`, 'u');
  const cued = indexOfWord(text, `${EDGE_BEFORE}(?:do|option|pick|choose|go with|answer)[\\s:]+${escapeRegExp(letter)}${EDGE_AFTER}`, 'iu');
  return [capital, cued].filter((at) => at >= 0).sort((a, b) => a - b)[0] ?? -1;
}

/**
 * The option a typed `text` names, by its whole label or (for 'A: …') its letter; undefined when it names none.
 * Among several named, the longest label wins; when a letter names one, the earliest in the text.
 */
export function optionNamed(need: Need, text: string): string | undefined {
  const named = need.options.flatMap((option) => {
    const whole = wholeAt(text, option);
    const letter = letterAt(text, option);
    const at = [whole, letter].filter((index) => index >= 0).sort((a, b) => a - b)[0];
    return at === undefined ? [] : [{ option, at, byLetter: letter >= 0 && (whole < 0 || letter < whole) }];
  });
  if (named.some((hit) => hit.byLetter)) named.sort((a, b) => a.at - b.at || b.option.length - a.option.length);
  else named.sort((a, b) => b.option.length - a.option.length);
  return named[0]?.option;
}

/** Whether `soleQuestion` (no other question is open) or the words themselves tie a message in Factory to this card. */
function aboutThisCard(need: Need, text: string, soleQuestion: boolean): boolean {
  return soleQuestion || (need.bead !== '' && text.toLowerCase().includes(need.bead.toLowerCase()));
}

/**
 * His words, typed after the question was asked, that name one of its options: a message in the bead's thread, or
 * one in Factory that names the bead (or the only question open), sent or still in the outbox. A tapped answer is
 * not words (the answers this phone sent say that); a message before the question, or naming no option, is not an answer.
 * `messages` are the bead's thread's and Factory's messages.
 */
export function answeredInWords(need: Need, messages: MessageRow[], outbox: OutboxRow[], soleQuestion: boolean): SaidAnswer | undefined {
  if (need.kind !== 'question' || need.bead === '') return undefined;
  const since = Date.parse(need.since);
  const late = (ms: number) => Number.isNaN(since) || ms >= since;
  const mine = `bead:${need.bead}`;
  const found: SaidAnswer[] = [];
  const consider = (text: string, thread: string | undefined, at: number) => {
    if (!late(at) || (thread !== undefined && thread !== mine)) return;
    const option = optionNamed(need, text);
    if (option === undefined || (thread === undefined && !aboutThisCard(need, text, soleQuestion))) return;
    found.push({ label: option, at });
  };
  for (const row of messages) {
    if (row.direction !== 'sent' || row.class !== 'message' || row.plaintext === undefined || decodeReply(row.plaintext)) continue;
    consider(decodeThreadedMessage(row.plaintext).text, row.thread, row.ts * 1000);
  }
  for (const row of outbox) {
    if (row.kind !== 'message' || row.state === 'failed' || typeof row.payload.text !== 'string') continue;
    consider(row.payload.text, row.thread, row.created);
  }
  return found.sort((a, b) => a.at - b.at)[0];
}

/** The card a question post in a thread stands for, asked at `at` (ms), so the evidence Needs you reads can be read for it. */
export function needOfQuestion(question: QuestionBody, at: number): Need {
  return { kind: 'question', bead: question.bead ?? '', epic: '', title: '', since: new Date(at).toISOString(), text: question.q, recommended: question.rec, options: question.options, blocks: 0, steps: [] };
}

/** What a question post in a thread has been answered with, by anything this phone holds but a tap in this session:
 * the answer it sent, the factory's ANSWER comment, or his words naming an option (as Needs you reads them, mw-gq6.199).
 * Only what came before `until` (ms, when the bead asked again) counts. */
export function answeredQuestion(
  need: Need,
  evidence: { sent: AnswerRow[]; comments: BeadComment[]; messages: MessageRow[]; outbox: OutboxRow[]; soleQuestion: boolean },
  until = Infinity,
): SaidAnswer | undefined {
  if (need.kind !== 'question' || need.bead === '') return undefined;
  const since = Date.parse(need.since);
  const sent = evidence.sent.find((row) => row.bead === need.bead && row.ts * 1000 >= since && row.ts * 1000 < until);
  if (sent) return { label: sent.answer, at: sent.ts * 1000 };
  const comments = evidence.comments.filter((comment) => !(Date.parse(comment.at) >= until));
  const messages = evidence.messages.filter((row) => row.ts * 1000 < until);
  const outbox = evidence.outbox.filter((row) => row.created < until);
  return answeredByComment(need, comments) ?? answeredInWords(need, messages, outbox, evidence.soleQuestion);
}

/** One labelled part of a hitl:<kind> need's body: Do this, Verified or Done when. */
export interface HitlPart {
  label: string;
  text: string;
}

const HITL_LABEL = /(?:^|\s)(Do this|Verified|Done when)\s*:?\s+/g;

/**
 * A hitl:<kind> need's text (docs/protocol.md §11, the body run together) split at its Do this / Verified /
 * Done when labels, in the order written. Words before the first label come first with an empty label.
 * A text with none of the labels gives [], and the card draws it as it is.
 */
export function hitlParts(text: string): HitlPart[] {
  const marks = [...text.matchAll(HITL_LABEL)];
  if (marks.length === 0) return [];
  const parts: HitlPart[] = [];
  const lead = text.slice(0, marks[0].index).trim();
  if (lead) parts.push({ label: '', text: lead });
  marks.forEach((mark, at) => {
    const from = mark.index + mark[0].length;
    const to = at + 1 < marks.length ? marks[at + 1].index : text.length;
    parts.push({ label: mark[1], text: text.slice(from, to).trim() });
  });
  return parts;
}
