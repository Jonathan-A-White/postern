// src/model/cards.ts — live cards (docs/protocol.md §24; millwright's domain/card.go) as
// pure data: the two plaintexts decoded, a stored card and its updates folded into the card
// as it now reads, and the rule that says which event ticks which item. Nothing here reads
// Dexie or the clock.
import type { CardRow, EventRow, StoredCardItem, StoredCardUpdate } from '../data/db';
import { threadKey } from '../services/threads';

export type CardRecord = NonNullable<CardRow['card']>;
export type CardUpdateRecord = Pick<StoredCardUpdate, 'items' | 'links' | 'tick'> & { re: string };

/** The states an item may expect of a bead (domain/card.go ExpectStates). */
export const EXPECT_STATES = ['open', 'landed', 'verified', 'closed', 'answered'] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v !== '') : [];
}

function decodeItem(value: unknown): StoredCardItem | undefined {
  const raw = record(value);
  if (!raw || typeof raw.n !== 'number' || !Number.isInteger(raw.n) || raw.n < 1 || typeof raw.text !== 'string') return undefined;
  const expect = record(raw.expect);
  const state = typeof expect?.state === 'string' ? expect.state : '';
  return {
    n: raw.n,
    text: raw.text,
    links: strings(raw.links),
    ...(expect && typeof expect.bead === 'string' && expect.bead !== '' && (EXPECT_STATES as readonly string[]).includes(state) ? { expect: { bead: expect.bead, state } } : {}),
    ...(raw.done === true ? { done: true } : {}),
    ...(typeof raw.done_at === 'number' ? { doneAt: raw.done_at } : {}),
  };
}

function decodeItems(value: unknown): StoredCardItem[] {
  return Array.isArray(value) ? value.map(decodeItem).filter((item): item is StoredCardItem => item !== undefined) : [];
}

function parse(text: string): Record<string, unknown> | undefined {
  try {
    return record(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/** A `card` record's plaintext (the Mayor's `mw card send`), or undefined when it is not one.
 * `ts` is the record's own, Unix seconds. An item with no number or text is left out. */
export function decodeCard(text: string, ts: number): CardRecord | undefined {
  const raw = parse(text);
  if (!raw || typeof raw.title !== 'string' || !Array.isArray(raw.items)) return undefined;
  const subscribe = record(raw.subscribe);
  return {
    title: raw.title,
    ...(typeof raw.prompt === 'string' && raw.prompt !== '' ? { prompt: raw.prompt } : {}),
    items: decodeItems(raw.items),
    subscribe: { kinds: strings(subscribe?.kinds), beads: strings(subscribe?.beads) },
    ts,
  };
}

/** The thread a card plaintext names (a bead's channel), as threadKey writes it; undefined is Factory. */
export function cardThread(text: string): string | undefined {
  const bead = record(parse(text)?.thread)?.bead;
  return typeof bead === 'string' && bead !== '' ? threadKey({ bead }) : undefined;
}

/** A `card-update` record's plaintext, or undefined when it names no card. */
export function decodeCardUpdate(text: string): CardUpdateRecord | undefined {
  const raw = parse(text);
  if (!raw || typeof raw.re !== 'string' || raw.re === '') return undefined;
  const links: Record<string, string[]> = {};
  for (const [n, ids] of Object.entries(record(raw.links) ?? {})) links[n] = strings(ids);
  const tick = Array.isArray(raw.tick) ? raw.tick.filter((n): n is number => typeof n === 'number' && Number.isInteger(n)) : [];
  return { re: raw.re, items: decodeItems(raw.items), links, tick };
}

export interface LiveCardItem {
  n: number;
  text: string;
  /** Bead ids: where he can go to do it. */
  links: string[];
  expect?: { bead: string; state: string };
  done: boolean;
  /** When it was ticked (ms): the event's time, or the update's. */
  doneAt?: number;
  /** Since when an event counts for it (ms): its card's or update's time. */
  since: number;
}

export interface LiveCard {
  id: string;
  title: string;
  prompt?: string;
  /** threadKey of the thread it was sent to; absent is Factory. */
  thread?: string;
  /** The card record's time (ms). */
  sentAt: number;
  items: LiveCardItem[];
  /** What it listens for (§24 `subscribe`), widened by the items an update added. */
  subscribe: { kinds: string[]; beads: string[] };
  /** Every item is done, so the card has left You for Done. */
  done: boolean;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** The card as it now reads: the record, then each update in the order sent (items added or
 * replaced by number, links merged, ticks set), then this phone's own ticks. Undefined while
 * only updates are held (the card record has not paged in yet). */
export function liveCard(row: CardRow): LiveCard | undefined {
  const card = row.card;
  if (!card) return undefined;
  const byN = new Map<number, LiveCardItem>();
  const add = (item: StoredCardItem, since: number) =>
    byN.set(item.n, { n: item.n, text: item.text, links: unique(item.links), ...(item.expect ? { expect: item.expect } : {}), done: item.done === true, ...(item.doneAt ? { doneAt: item.doneAt * 1000 } : {}), since });
  for (const item of card.items) add(item, card.ts * 1000);
  const updates = [...row.updates].sort((a, b) => a.seq - b.seq || a.ts - b.ts);
  for (const update of updates) {
    for (const item of update.items) add(item, update.ts * 1000);
    for (const [n, ids] of Object.entries(update.links)) {
      const item = byN.get(Number(n));
      if (item) item.links = unique([...item.links, ...ids]);
    }
    for (const n of update.tick) {
      const item = byN.get(n);
      if (item && !item.done) {
        item.done = true;
        item.doneAt = update.ts * 1000;
      }
    }
  }
  for (const [n, at] of Object.entries(row.ticks)) {
    const item = byN.get(Number(n));
    if (item && !item.done) {
      item.done = true;
      item.doneAt = at;
    }
  }
  const items = [...byN.values()].sort((a, b) => a.n - b.n);
  const kinds = [...card.subscribe.kinds];
  const beads = [...card.subscribe.beads];
  for (const item of items) {
    beads.push(...item.links);
    if (item.expect) {
      beads.push(item.expect.bead);
      kinds.push(item.expect.state === 'answered' ? 'card_answered' : 'bead_changed');
    }
  }
  return {
    id: row.id,
    title: card.title,
    ...(card.prompt ? { prompt: card.prompt } : {}),
    ...(row.thread ? { thread: row.thread } : {}),
    sentAt: card.ts * 1000,
    items,
    subscribe: { kinds: unique(kinds), beads: unique(beads) },
    done: items.length > 0 && items.every((item) => item.done),
  };
}

/** What settles an item, by the state it waits for (docs/protocol.md §24): landing leads on to
 * verified and closing, so landed is also met by a move to either; a story closes at landing,
 * before it is verified, so verified is met by verified alone. Any other state, by itself. */
const MET_BY: Record<string, string[]> = {
  landed: ['landed', 'verified', 'closed'],
  verified: ['verified'],
  closed: ['closed'],
};

/** Whether `event` is the one that item's expectation waits for: its bead moving (from differs from
 * to; a comment leaves them equal) to the state, or to one that settles it, or, for `answered`, a card on that bead answered. */
export function meetsExpectation(expect: { bead: string; state: string }, event: EventRow): boolean {
  if (event.bead !== expect.bead) return false;
  if (expect.state === 'answered') return event.kind === 'card_answered';
  if (event.kind !== 'bead_changed' || event.from === event.to) return false;
  return (MET_BY[expect.state] ?? [expect.state]).includes(event.to);
}

/** The items of `card` that `events` (any order) tick: item number to the time (ms) of the first
 * event, no earlier than the item itself, that its expectation waits for. Items already done are left out. */
export function ticksFrom(card: LiveCard, events: EventRow[]): Record<number, number> {
  const ticks: Record<number, number> = {};
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  for (const item of card.items) {
    if (item.done || !item.expect) continue;
    const expect = item.expect;
    const hit = ordered.find((event) => {
      const at = Date.parse(event.ts);
      return meetsExpectation(expect, event) && (Number.isNaN(at) || at >= item.since);
    });
    if (hit) ticks[item.n] = Number.isNaN(Date.parse(hit.ts)) ? item.since : Date.parse(hit.ts);
  }
  return ticks;
}
