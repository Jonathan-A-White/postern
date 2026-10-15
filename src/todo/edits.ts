// src/todo/edits.ts — the To do board's hand edits (mw-ev7oyy.7), pure: the §13 todo_* actions, what
// the board shows for them before the Mayor has answered (applyChanges), the place a dropped card
// goes (dropPlace, moveFor), and when a change that was sent is still waiting, settled, or refused
// (judge). No React, no storage; posternStore.ts reads the outbox and calls these.
import type { OutboxRow } from '../data/db';
import { OTHER_LIST, type TodoCard, type TodoList } from './lists';

/** The place a card goes (docs/protocol.md §13 todo_move): another list, and/or before or after a card there. */
export interface TodoMove {
  list?: string;
  before?: string;
  after?: string;
}

/** What he may change on a card. */
export interface TodoCardEdit {
  title?: string;
  notes?: string;
  /** A UTC time to set, or '' to clear it. */
  due?: string;
  /** Starred (true) or not (false). */
  important?: boolean;
}

export type TodoAction =
  | { action: 'todo_add'; list: string; title: string; notes?: string }
  | { action: 'todo_edit'; bead: string; title?: string; notes?: string; due?: string; important?: boolean }
  | { action: 'todo_move'; bead: string; list?: string; before?: string; after?: string };

/** One change that has been sent or is waiting to be, in the order made; `id` is its outbox row. */
export interface TodoChange {
  id: number;
  action: TodoAction;
}

export const PENDING_PREFIX = 'pending:';

const isTodoAction = (value: unknown): value is TodoAction => {
  const action = (value as { action?: unknown } | undefined)?.action;
  return action === 'todo_add' || action === 'todo_edit' || action === 'todo_move';
};

/** The todo_* action an outbox row carries, if it carries one. */
export function todoActionOf(row: OutboxRow): TodoAction | undefined {
  return row.kind === 'action' && isTodoAction(row.payload.action) ? row.payload.action : undefined;
}

/** The board as it will be once the Mayor has done what the changes ask, and the notes an edit set (by card). A change whose card or list has left the board is skipped. */
export function applyChanges(lists: TodoList[], changes: TodoChange[]): { lists: TodoList[]; notes: Map<string, string> } {
  const out = lists.map((list) => ({ ...list, cards: [...list.cards] }));
  const notes = new Map<string, string>();
  const listOf = (card: string) => out.find((list) => list.cards.some((candidate) => candidate.id === card));
  for (const { id, action } of changes) {
    if (action.action === 'todo_add') {
      const list = out.find((candidate) => candidate.id === action.list);
      if (!list) continue;
      const made = `${PENDING_PREFIX}${id}`;
      list.cards.push({ id: made, title: action.title, priority: 2, created: '', pending: true, adding: true });
      if (action.notes) notes.set(made, action.notes);
    } else if (action.action === 'todo_edit') {
      const list = listOf(action.bead);
      if (!list) continue;
      list.cards = list.cards.map((card) => {
        if (card.id !== action.bead) return card;
        const next: TodoCard = { ...card, title: action.title ?? card.title, pending: true };
        if (action.due) next.due = action.due;
        else if (action.due === '') delete next.due;
        if (action.important) next.important = true;
        else if (action.important === false) delete next.important;
        return next;
      });
      if (action.notes !== undefined) notes.set(action.bead, action.notes);
    } else {
      const from = listOf(action.bead);
      const to = action.list ? out.find((candidate) => candidate.id === action.list) : from;
      if (!from || !to) continue;
      const moved = from.cards.find((card) => card.id === action.bead) as TodoCard;
      from.cards = from.cards.filter((card) => card.id !== action.bead);
      const before = action.before ? to.cards.findIndex((card) => card.id === action.before) : -1;
      const after = action.after ? to.cards.findIndex((card) => card.id === action.after) : -1;
      const index = before >= 0 ? before : after >= 0 ? after + 1 : to.cards.length;
      to.cards.splice(index, 0, { ...moved, pending: true });
    }
  }
  return { lists: out, notes };
}

/** The todo_move that lands `card` at `index` among the cards of `list` once it is lifted out (so its own place is not counted). Undefined when that is where it already is, when the card is still being added, or when the list is Other (no epic to name). Anchors are cards the Mayor knows, never one still being added. */
export function moveFor(lists: TodoList[], card: string, list: string, index: number): TodoMove | undefined {
  const from = lists.find((candidate) => candidate.cards.some((c) => c.id === card));
  const to = lists.find((candidate) => candidate.id === list);
  if (!from || !to || from.cards.find((c) => c.id === card)?.adding) return undefined;
  if (to.id === OTHER_LIST && from.id !== OTHER_LIST) return undefined;
  const rest = to.cards.filter((c) => c.id !== card);
  const at = Math.max(0, Math.min(index, rest.length));
  if (from.id === to.id && from.cards.findIndex((c) => c.id === card) === at) return undefined;
  const next = rest.slice(at).find((c) => !c.adding);
  const previous = rest.slice(0, at).reverse().find((c) => !c.adding);
  const place = next ? { before: next.id } : previous ? { after: previous.id } : {};
  const named = from.id === to.id || !to.epic ? {} : { list: to.epic };
  return 'before' in place || 'after' in place || 'list' in named ? { ...named, ...place } : undefined;
}

/** Where a card dropped at `shown` (counted among the cards on screen, without the card itself) lies among all the cards of `list` (counted without it too):
 * before the shown card it came to, else after the last shown one; a list with nothing shown takes it at its foot. */
export function realIndex(list: TodoList, card: string, shown: number, isShown: (other: TodoCard) => boolean): number {
  const rest = list.cards.filter((other) => other.id !== card);
  const seen = rest.filter(isShown);
  if (shown < seen.length) return rest.indexOf(seen[shown]);
  return seen.length > 0 ? rest.indexOf(seen[seen.length - 1]) + 1 : rest.length;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A column on screen with its cards, measured. */
export interface MeasuredColumn {
  id: string;
  rect: Box;
  cards: { id: string; rect: Box }[];
}

/** Where a dragged card's pointer is: the list under it and how many of that list's other cards lie wholly above its middle. Undefined off every column. */
export function dropPlace(columns: MeasuredColumn[], dragged: string, x: number, y: number): { list: string; index: number } | undefined {
  const column = columns.find(({ rect }) => x >= rect.left && x < rect.right && y >= rect.top && y <= rect.bottom);
  if (!column) return undefined;
  const above = column.cards.filter((card) => card.id !== dragged && (card.rect.top + card.rect.bottom) / 2 < y);
  return { list: column.id, index: above.length };
}

/** How long the Mayor's host is given to echo a change that has gone before the phone calls it refused. The host applies a message the moment it arrives and echoes it within seconds. */
export const REFUSED_AFTER_MS = 90_000;

/** How long a refusal stays on the board for him to read, from when the change went. */
export const NOTE_FOR_MS = 10 * 60_000;

export type ChangeState = 'waiting' | 'settled' | 'refused' | 'failed';

/** What the phone knows to judge a change by: the seq of the event that echoed it, the view on screen, the time. */
export interface JudgeContext {
  echoSeq?: number;
  view?: { seq?: number; writtenAt?: string };
  now: number;
}

/** A sent change is waiting until the view on screen has reached the event that echoed it (then it is settled, the view is the truth),
 * and refused when it went, REFUSED_AFTER_MS passed and no echo came (the Mayor's host mails him a refusal and echoes nothing);
 * one the backend refused for good is failed. No clock is compared when the view carries a seq. */
export function judge(row: OutboxRow, { echoSeq, view, now }: JudgeContext): ChangeState {
  if (row.state === 'failed') return 'failed';
  if (echoSeq !== undefined) {
    const written = Date.parse(view?.writtenAt ?? '');
    const agreed = view?.seq !== undefined ? view.seq >= echoSeq : !Number.isNaN(written) && written > (row.sentAt ?? row.created);
    return agreed ? 'settled' : 'waiting';
  }
  return row.sentAt !== undefined && now - row.sentAt > REFUSED_AFTER_MS ? 'refused' : 'waiting';
}

/** A change the board could not keep: the backend refused it, or the Mayor's host did. */
export interface TodoNotice {
  /** The outbox row. */
  id: number;
  kind: 'failed' | 'refused';
  /** What was asked, in his words: 'Moving “Take the trash out”'. */
  words: string;
  /** What the backend said, on a failed one. */
  failure?: string;
}

/** What a change asked, as a short phrase naming the card. */
export function describeChange(action: TodoAction, titleOf: (bead: string) => string | undefined): string {
  if (action.action === 'todo_add') return `Adding “${action.title}”`;
  const name = titleOf(action.bead) ?? action.bead;
  return action.action === 'todo_edit' ? `Saving “${name}”` : `Moving “${name}”`;
}
