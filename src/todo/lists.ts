// src/todo/lists.ts — the To do board's lists and cards, from the view (mw-ev7oyy.4). A list is
// an epic; a card is an open bead labelled hitl:todo under it. Pure: no React, no storage.
import { BEAD_ID, WORD_CHAR } from '../markdown/beadLinks';
import { isClosed, type ViewIndex } from '../model/tree';
import type { ViewBead } from '../model/view';
import { dayKey, dueMs, isDueSoon } from './due';
import { parseWhen, type When } from './calendar';
import { parseEmailAction, parseListenAction, parseOpenLinks, parseTextAction, type EmailAction, type ListenAction, type OpenLink, type TextAction } from './links';

export const TODO_LABEL = 'hitl:todo';

/** The column for cards whose bead has no epic in the view. */
export const OTHER_LIST = 'other';

/** The sizes a card can have, smallest first (docs/protocol.md §11 todo_size). */
export type TodoSize = 'quick' | 'hour' | 'half-day';

/** The rows the nightly ranking pass puts a card in (docs/protocol.md §11 todo_row), in the order the board shows them (Later last but one). */
export type TodoRow = 'now' | 'make-time' | 'later' | 'let-go';

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
  /** How big it is (the bead's todo_size), absent when it has none (mw-ht6gsw.4). */
  size?: TodoSize;
  /** What must follow it (the bead's todo_then), absent when it has none (mw-ht6gsw.4). */
  then?: string;
  /** The links of the 'Open:' line of its notes, as far as the view's summary shows them; the board reads the whole notes when the summary is cut short (mw-ev7oyy.12). */
  links?: OpenLink[];
  /** The 'Text:' line of its notes, when the view's summary holds it whole (not cut short): its Text button (mw-ev7oyy.22). */
  text?: TextAction;
  /** The 'Email:' line of its notes, when the view's summary holds it whole (not cut short): its Email button (mw-ev7oyy.26). */
  email?: EmailAction;
  /** The Audible book (and chapter) of its notes, when the view's summary holds them whole (not cut short): its Listen in Audible button (mw-ev7oyy.24). */
  listen?: ListenAction;
  /** The 'When:' line of its notes, when the view's summary holds it whole (not cut short): its Add to Google Calendar and Download .ics taps, or a note that the line did not read (mw-ev7oyy.32). */
  when?: When;
  /** The view's summary of the notes may have been cut short: the notes themselves may hold more links. */
  summaryCut?: boolean;
  /** The row the pass put it in (the bead's todo_row), absent before the pass has run on it (mw-ht6gsw.5). */
  row?: TodoRow;
  /** The pass's one line on why it is in its row (the bead's todo_row_why). */
  rowWhy?: string;
  /** He tapped it into Today for today (pickCards stamps it): it comes first in its list's column under Later. */
  tapped?: boolean;
  /** A change of his to this card has gone and the view does not yet agree (edits.ts). */
  pending?: boolean;
  /** The card is one he has just added: the Mayor has not made it, so it has no id yet. */
  adding?: boolean;
}

/** The cards tapped into Today, by card id: the calendar day (dayKey) the tap was made. A tap holds for that day only. */
export type TodayPicks = Readonly<Record<string, string>>;

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

/** THE order of a list's cards with the Today taps (mw-ht6gsw.5): orderCards' order, the cards he has tapped into Today (for the day he tapped
 * and no longer) first, each stamped `tapped`. The cards given are not changed. */
export function pickCards(cards: readonly TodoCard[], now: number, picks: TodayPicks): TodoCard[] {
  const ordered = orderCards(cards, now);
  const tapped = (card: TodoCard) => picks[card.id] === dayKey(now);
  return [...ordered.filter(tapped).map((card): TodoCard => ({ ...card, tapped: true })), ...ordered.filter((card) => !tapped(card))];
}

/** How many cards each of Do now and Make time holds at most. A card past that goes to Later. */
export const ROW_LIMIT = 3;

/** A card on the board's rows, with the list it belongs to. */
export interface RowCard {
  card: TodoCard;
  list: TodoList;
}

/** Do now: the card due soonest first, then the starred ones, then the longest waiting. */
function doNowOrder(a: RowCard, b: RowCard): number {
  const due = (entry: RowCard) => dueMs(entry.card.due) ?? Infinity;
  if (due(a) !== due(b)) return due(a) < due(b) ? -1 : 1;
  return waitingOrder(a, b, true);
}

/** The longest waiting first (the oldest bead), then the star first when asked; the id last so the order is whole. */
function waitingOrder(a: RowCard, b: RowCard, starFirst = false): number {
  if (starFirst && a.card.important !== b.card.important) return a.card.important ? -1 : 1;
  return a.card.created.localeCompare(b.card.created) || a.card.id.localeCompare(b.card.id, undefined, { numeric: true });
}

/** The board's rows over every list (mw-ht6gsw.5): Do now and Make time hold the cards the pass put there, at most ROW_LIMIT each (the rest
 * go to Later), Let go the cards it let go; every other card, one the pass has not run on included, is Later. `later` is the ids of the Later cards. */
export function boardRows(lists: readonly TodoList[]): { doNow: RowCard[]; makeTime: RowCard[]; letGo: RowCard[]; later: Set<string>; laterCount: number } {
  const all = lists.flatMap((list) => list.cards.filter((card) => !card.adding).map((card): RowCard => ({ card, list })));
  const inRow = (row: TodoRow) => all.filter((entry) => entry.card.row === row);
  const doNow = inRow('now').sort(doNowOrder).slice(0, ROW_LIMIT);
  const makeTime = inRow('make-time').sort((a, b) => waitingOrder(a, b)).slice(0, ROW_LIMIT);
  const letGo = inRow('let-go').sort((a, b) => waitingOrder(a, b));
  const placed = new Set([...doNow, ...makeTime, ...letGo].map((entry) => entry.card.id));
  const later = new Set(lists.flatMap((list) => list.cards.filter((card) => !placed.has(card.id)).map((card) => card.id)));
  return { doNow, makeTime, letGo, later, laterCount: later.size };
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
  const cut = summaryMayBeCut(bead.summary);
  // a summary cut short may have cut the draft short too: the board reads the whole notes for it then
  const text = cut ? undefined : parseTextAction(bead.summary);
  const email = cut ? undefined : parseEmailAction(bead.summary);
  const listen = cut ? undefined : parseListenAction(bead.summary);
  const when = cut ? undefined : parseWhen(bead.summary);
  return { id: bead.id, title: bead.title, priority: bead.priority, created: bead.created, ...(bead.todo_rank !== undefined ? { rank: bead.todo_rank } : {}), ...(bead.todo_due ? { due: bead.todo_due } : {}), ...(bead.todo_important ? { important: true } : {}), ...(bead.todo_row ? { row: bead.todo_row } : {}), ...(bead.todo_row_why ? { rowWhy: bead.todo_row_why } : {}), ...(bead.todo_size ? { size: bead.todo_size } : {}), ...(bead.todo_then ? { then: bead.todo_then } : {}), ...(links.length ? { links } : {}), ...(text ? { text } : {}), ...(email ? { email } : {}), ...(listen ? { listen } : {}), ...(when ? { when } : {}), ...(cut ? { summaryCut: true } : {}) };
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
