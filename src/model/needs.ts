// src/model/needs.ts — which needs still wait on the Governor (plans/0021
// decision 8). One he has answered or acted on since it was raised leaves the
// queue at once, before the Mayor's host has applied it and the view drops it.
import type { AnswerRow, MessageRow, OutboxRow } from '../data/db';
import { decodeReply } from '../services/questions';
import { decodeThreadedMessage } from '../services/threads';
import { isEpic, type ViewIndex } from './tree';
import type { BeadComment, Need, WaitsFor } from './view';

export function unsettledNeeds(needs: Need[], answers: AnswerRow[]): Need[] {
  const answered = new Map(answers.map((row) => [row.bead, row.ts * 1000]));
  return needs.filter((need) => {
    const at = answered.get(need.bead);
    if (at === undefined || !need.bead) return true;
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
  const split: Record<WaitsFor, Need[]> = { you: [], mayor: [], factory: [] };
  for (const need of needs) split[waitsFor(need)].push(need);
  return split;
}

/** A stale need (docs/protocol.md §11) always offers Keep then Close. */
export const STALE_OPTIONS = ['Keep', 'Close'];

/** The recommended answer first, then the rest in the Mayor's order. */
export function orderedOptions(need: Need): string[] {
  const options = need.kind === 'hands' ? ['Done'] : need.kind === 'demo' ? ['Looks good'] : need.kind === 'stale' ? [...STALE_OPTIONS] : [...need.options];
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

function names(text: string, words: string): boolean {
  const word = words.trim().toLowerCase();
  if (word === '') return false;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(text.toLowerCase());
}

/** The option a typed `text` names, the longest when it names several; undefined when it names none. */
export function optionNamed(need: Need, text: string): string | undefined {
  return need.options.filter((option) => names(text, option)).sort((a, b) => b.length - a.length)[0];
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
