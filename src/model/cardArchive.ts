// src/model/cardArchive.ts — when a live card leaves Needs you for 'Archived cards' (mw-v1uyku.1).
// The Governor: a card that has sat there long enough means he has moved on, and it should leave his
// headspace, kept to go back to and still updating. A card is fresh while anything has happened to it
// within CARD_ARCHIVE_AFTER_MS: it was sent, updated or ticked, a link of it was tapped, or a message
// names a bead it is about. Nothing here deletes a card or reads the clock.
import type { MessageRow } from '../data/db';
import type { LiveCard } from './cards';

/** How long a card may go untouched before it is archived (48 h; provisional, the Governor to confirm). */
export const CARD_ARCHIVE_AFTER_MS = 48 * 60 * 60 * 1000;

/** The message classes that are words said to or by him; a card, its update, events, a Talk turn or a call are not. */
const SPOKEN: string[] = ['message', 'decision-needed', 'landing'];

/** Every bead the card is about: its thread's, the ones its items link to and the ones it listens for. */
function beadsOf(card: LiveCard): string[] {
  const own = card.thread?.startsWith('bead:') ? [card.thread.slice(5)] : [];
  return [...new Set([...own, ...card.items.flatMap((item) => item.links), ...card.subscribe.beads])];
}

/** A pattern for a bead id standing alone in words: `mw-a.1` is not found in `mw-a.10` or `mw-a.1.2`. */
function idPattern(beads: string[]): RegExp {
  const ids = beads.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?<![\\w.-])(?:${ids.join('|')})(?![\\w-]|\\.\\w)`);
}

/** The latest time (ms) a message names one of the card's beads, in its thread or in its words; 0 when none does. */
export function mentionedAt(card: LiveCard, messages: MessageRow[]): number {
  const beads = beadsOf(card);
  if (beads.length === 0) return 0;
  const pattern = idPattern(beads);
  let latest = 0;
  for (const row of messages) {
    if (!SPOKEN.includes(row.class) || row.ts * 1000 <= latest) continue;
    const named = (row.thread?.startsWith('bead:') && beads.includes(row.thread.slice(5))) || (row.plaintext !== undefined && pattern.test(row.plaintext));
    if (named) latest = row.ts * 1000;
  }
  return latest;
}

/** The card's last touch (ms), mentions included. */
export function lastTouched(card: LiveCard, messages: MessageRow[]): number {
  return Math.max(card.touchedAt, mentionedAt(card, messages));
}

/** Whether the card has gone untouched for 48 h at `now` (ms). */
export function isArchived(card: LiveCard, messages: MessageRow[], now: number): boolean {
  return now - lastTouched(card, messages) >= CARD_ARCHIVE_AFTER_MS;
}

/** The cards split at `now`: the fresh ones, and the archived ones newest touch first. Each keeps its order otherwise. */
export function splitArchive(cards: LiveCard[], messages: MessageRow[], now: number): { fresh: LiveCard[]; archived: LiveCard[] } {
  const fresh: LiveCard[] = [];
  const archived: { card: LiveCard; at: number }[] = [];
  for (const card of cards) {
    if (isArchived(card, messages, now)) archived.push({ card, at: lastTouched(card, messages) });
    else fresh.push(card);
  }
  return { fresh, archived: archived.sort((a, b) => b.at - a.at).map((entry) => entry.card) };
}
