// src/todo/lists.ts — the To do board's lists and cards, from the view (mw-ev7oyy.4). A list is
// an epic; a card is an open bead labelled hitl:todo under it. Pure: no React, no storage.
import { BEAD_ID, WORD_CHAR } from '../markdown/beadLinks';
import { isClosed, type ViewIndex } from '../model/tree';
import type { ViewBead } from '../model/view';
import { dueMs, isDueSoon } from './due';
import { parseOpenLinks, type OpenLink } from './links';

export const TODO_LABEL = 'hitl:todo';

/** The column for cards whose bead has no epic in the view. */
export const OTHER_LIST = 'other';

export interface TodoCard {
  id: string;
  title: string;
  priority: number;
  created: string;
  rank?: number | string;
  /** When it is due, an RFC 3339 UTC time (the bead's todo_due), absent when it has none. */
  due?: string;
  /** He has starred it (the bead's todo_important): it sorts above the cards that are neither starred nor due soon. */
  important?: boolean;
  /** The links of the 'Open:' line of its notes, as far as the view's summary shows them; the board reads the whole notes when the summary is cut short (mw-ev7oyy.12). */
  links?: OpenLink[];
  /** The view's summary of the notes may have been cut short: the notes themselves may hold more links. */
  summaryCut?: boolean;
  /** A change of his to this card has gone and the view does not yet agree (edits.ts). */
  pending?: boolean;
  /** The card is one he has just added: the Mayor has not made it, so it has no id yet. */
  adding?: boolean;
}

export interface TodoList {
  /** The epic's bead id, or OTHER_LIST. */
  id: string;
  /** The epic's whole title. */
  title: string;
  /** What the list's header says: its short name (shortName), one line. */
  name: string;
  /** The epic's bead id when the heading links to its page; absent on Other. */
  epic?: string;
  created: string;
  cards: TodoCard[];
}

/** A list's short name for its header (mw-ev7oyy.14): the epic's todo_name when it has one, else its title cut at the
 * first ':' (a colon then a space, so a time of day stays whole) or ' ('; the whole title when nothing is left. */
export function shortName(title: string, todoName?: string): string {
  const named = todoName?.trim();
  if (named) return named;
  const whole = title.trim();
  const cut = whole.search(/:(\s|$)| \(/);
  const short = cut > 0 ? whole.slice(0, cut).trim() : whole;
  return short || whole;
}

/** Numbers first (as numbers), then strings (as text), then the unranked. */
function rankOrder(a: TodoCard, b: TodoCard): number {
  const group = (card: TodoCard) => (card.rank === undefined ? 2 : typeof card.rank === 'number' ? 0 : 1);
  const byGroup = group(a) - group(b);
  if (byGroup !== 0) return byGroup;
  if (typeof a.rank === 'number' && typeof b.rank === 'number') return a.rank - b.rank;
  if (typeof a.rank === 'string' && typeof b.rank === 'string') return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
  return 0;
}

/** The order a list shows its cards: todo_rank, then priority, then the oldest first. */
export function cardOrder(a: TodoCard, b: TodoCard): number {
  return rankOrder(a, b) || a.priority - b.priority || a.created.localeCompare(b.created) || a.id.localeCompare(b.id, undefined, { numeric: true });
}

/** THE order a list shows its cards (mw-ev7oyy.15), given the cards in his own order (cardOrder, or the board as edited): the cards due within
 * 48 hours or past due first, soonest first; then the important ones; then the rest. Each of the last two keeps the order it came in, so
 * nothing else changes order. The cards given are not changed. */
export function orderCards(cards: readonly TodoCard[], now: number): TodoCard[] {
  const soon = cards.filter((card) => isDueSoon(card.due, now)).sort((a, b) => (dueMs(a.due) as number) - (dueMs(b.due) as number));
  const rest = cards.filter((card) => !isDueSoon(card.due, now));
  return [...soon, ...rest.filter((card) => card.important), ...rest.filter((card) => !card.important)];
}

/** How many runes of the notes the view's summary holds (docs/protocol.md §11). */
const SUMMARY_RUNES = 280;

/** The 'Open:' line links of a bead's notes (links.ts), for a card's chips. */
export const openLinksOf = parseOpenLinks;

/** Whether the view's summary of a bead's notes (its first 280 runes) may have been cut, so that an 'Open:' line past it is not seen. */
export function summaryMayBeCut(summary: string): boolean {
  return [...summary].length >= SUMMARY_RUNES - 20;
}

function cardOf(bead: ViewBead): TodoCard {
  const links = openLinksOf(bead.summary);
  return { id: bead.id, title: bead.title, priority: bead.priority, created: bead.created, ...(bead.todo_rank !== undefined ? { rank: bead.todo_rank } : {}), ...(bead.todo_due ? { due: bead.todo_due } : {}), ...(bead.todo_important ? { important: true } : {}), ...(links.length ? { links } : {}), ...(summaryMayBeCut(bead.summary) ? { summaryCut: true } : {}) };
}

/** The open hitl:todo beads of the view grouped under their parent epic: newest list first, Other last,
 * each list's cards in cardOrder, then floated by orderCards. A hitl:todo epic is a list, never a card; closed beads, beads without
 * the label and epics with nothing open on them are left out. */
export function todoListsFromView(index: ViewIndex, now: number): TodoList[] {
  const lists = new Map<string, TodoList>();
  for (const bead of index.view.beads) {
    if (!bead.labels.includes(TODO_LABEL) || isClosed(bead) || bead.type === 'epic') continue;
    const epic = bead.parent ? index.byId.get(bead.parent) : undefined;
    const key = epic?.id ?? OTHER_LIST;
    let list = lists.get(key);
    if (!list) {
      list = epic ? { id: epic.id, title: epic.title, name: shortName(epic.title, epic.todo_name), epic: epic.id, created: epic.created, cards: [] } : { id: OTHER_LIST, title: 'Other', name: 'Other', created: '', cards: [] };
      lists.set(key, list);
    }
    list.cards.push(cardOf(bead));
  }
  for (const list of lists.values()) list.cards = orderCards([...list.cards].sort(cardOrder), now);
  const newestFirst = (a: TodoList, b: TodoList) => b.created.localeCompare(a.created) || b.id.localeCompare(a.id, undefined, { numeric: true });
  const named = [...lists.values()].filter((list) => list.id !== OTHER_LIST).sort(newestFirst);
  const other = lists.get(OTHER_LIST);
  return other ? [...named, other] : named;
}

/** How many open cards there are in all, the figure on the tab. */
export function openTodoCount(index: ViewIndex): number {
  return todoListsFromView(index, 0).reduce((sum, list) => sum + list.cards.length, 0);
}

/** The beads a card's words name (mw-… ids), each once in the order met, not the card itself. */
export function beadsNamed(own: string, texts: readonly string[]): string[] {
  const found: string[] = [];
  for (const text of texts) {
    for (const match of text.matchAll(BEAD_ID)) {
      const before = match.index > 0 ? text[match.index - 1] : '';
      if (before && WORD_CHAR.test(before)) continue;
      if (match[0] !== own && !found.includes(match[0])) found.push(match[0]);
    }
  }
  return found;
}
