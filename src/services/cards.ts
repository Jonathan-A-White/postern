// src/services/cards.ts — live cards (docs/protocol.md §24) on this phone (mw-nqur1n.11).
// A `card` or `card-update` record the sync keeps is folded into the cards table; the app
// ticks an item off itself when the event its expectation waits for is held, with no record.
import { cardsRepo, eventsRepo } from '../data/repositories';
import type { MessageRow } from '../data/db';
import { cardThread, decodeCard, decodeCardUpdate, ticksFrom, type LiveCard } from '../model/cards';

/** Folds one decrypted card or card-update row into the cards table. Anything else, a locked
 * row, a card this phone sent itself or a plaintext that is not that shape is left alone; a repeat changes nothing. */
export async function applyCardRow(row: MessageRow): Promise<void> {
  if (row.plaintext === undefined || row.direction !== 'received') return;
  if (row.class === 'card') {
    const card = decodeCard(row.plaintext, row.ts);
    if (card) await cardsRepo.putCard(row.txid, card, cardThread(row.plaintext));
  } else if (row.class === 'card-update') {
    const update = decodeCardUpdate(row.plaintext);
    if (update) await cardsRepo.putUpdate(update.re, { txid: row.txid, seq: row.seq, ts: row.ts, items: update.items, links: update.links, tick: update.tick });
  }
}

/** Ticks the items of `card` whose expected event is already held: each gets that event's time.
 * Resolves with the item numbers it ticked. Nothing is fetched. */
export async function tickFromEvents(card: LiveCard): Promise<number[]> {
  if (card.done || card.subscribe.beads.length === 0) return [];
  const ticks = ticksFrom(card, await eventsRepo.forBeads(card.subscribe.beads));
  const numbers = Object.keys(ticks).map(Number);
  if (numbers.length > 0) await cardsRepo.tick(card.id, ticks);
  return numbers;
}
