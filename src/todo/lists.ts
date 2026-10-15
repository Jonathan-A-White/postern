// src/todo/lists.ts — the To do board's lists and cards, from the view (mw-ev7oyy.4). A list is
// an epic; a card is an open bead labelled hitl:todo under it. Pure: no React, no storage.
import { BEAD_ID, WORD_CHAR } from '../markdown/beadLinks';
import { isClosed, type ViewIndex } from '../model/tree';
import type { ViewBead } from '../model/view';
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
  title: string;
  /** The epic's bead id when the heading links to its page; absent on Other. */
  epic?: string;
  created: string;
  cards: TodoCard[];
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
  return { id: bead.id, title: bead.title, priority: bead.priority, created: bead.created, ...(bead.todo_rank !== undefined ? { rank: bead.todo_rank } : {}), ...(bead.todo_due ? { due: bead.todo_due } : {}), ...(links.length ? { links } : {}), ...(summaryMayBeCut(bead.summary) ? { summaryCut: true } : {}) };
}

/** The open hitl:todo beads of the view grouped under their parent epic: newest list first, Other last,
 * each list's cards in cardOrder. A hitl:todo epic is a list, never a card; closed beads, beads without
 * the label and epics with nothing open on them are left out. */
export function todoListsFromView(index: ViewIndex): TodoList[] {
  const lists = new Map<string, TodoList>();
  for (const bead of index.view.beads) {
    if (!bead.labels.includes(TODO_LABEL) || isClosed(bead) || bead.type === 'epic') continue;
    const epic = bead.parent ? index.byId.get(bead.parent) : undefined;
    const key = epic?.id ?? OTHER_LIST;
    let list = lists.get(key);
    if (!list) {
      list = epic ? { id: epic.id, title: epic.title, epic: epic.id, created: epic.created, cards: [] } : { id: OTHER_LIST, title: 'Other', created: '', cards: [] };
      lists.set(key, list);
    }
    list.cards.push(cardOf(bead));
  }
  for (const list of lists.values()) list.cards.sort(cardOrder);
  const newestFirst = (a: TodoList, b: TodoList) => b.created.localeCompare(a.created) || b.id.localeCompare(a.id, undefined, { numeric: true });
  const named = [...lists.values()].filter((list) => list.id !== OTHER_LIST).sort(newestFirst);
  const other = lists.get(OTHER_LIST);
  return other ? [...named, other] : named;
}

/** How many open cards there are in all, the figure on the tab. */
export function openTodoCount(index: ViewIndex): number {
  return todoListsFromView(index).reduce((sum, list) => sum + list.cards.length, 0);
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
