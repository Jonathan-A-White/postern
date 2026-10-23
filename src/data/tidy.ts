// src/data/tidy.ts — the history-wide clean-ups, run once the app is on screen (mw-4gkijo.1). They used to run in
// Dexie's `ready`, before the first query of every open: with a long history the door waited on a scan of every message.
import { db } from './db';
import { eventsRepo } from './repositories/events-repo';
import { twinsToDrop } from '../model/twins';

/** How many of the newest events the phone keeps; every emergency and every event not yet applied to the view stay besides. */
export const EVENTS_KEPT = 5000;

/** mw-jrx0s.22: an events record (§22) is never a message. An older build kept some as rows; they are removed. */
async function dropEventsRows(): Promise<void> {
  const rows = await db.messages.where('class').equals('events').primaryKeys();
  if (rows.length > 0) await db.messages.bulkDelete(rows);
}

/** mw-gq6.718: the phone has held every factory event since mw-jrx0s.7 and kept them for good; the screens need the
 * recent ones (a card's items, the echo of a tap) and the emergencies, so the oldest past EVENTS_KEPT are dropped. */
async function trimEvents(): Promise<void> {
  await eventsRepo.trim(EVENTS_KEPT);
}

/** mw-f758y.40: a reply that came direct and on chain was kept twice by older builds; the direct copy alone stays. */
async function dropTwins(): Promise<void> {
  const dropped = twinsToDrop(await db.messages.toArray());
  if (dropped.length > 0) await db.messages.bulkDelete(dropped.map((row) => row.id));
}

/** The clean-ups, in that order. A failure is the caller's to say; nothing here is needed to open the app. */
export async function tidyHistory(): Promise<void> {
  await dropEventsRows();
  await trimEvents();
  await dropTwins();
}

let started = false;

/** Forgets that the clean-ups ran this page load (tests). */
export function forgetTidied(): void {
  started = false;
}

/**
 * Starts `tidyHistory` once per page load, when the browser is idle (or soon after, where it has no idle
 * callback), so it never sits between the first paint and the door. Returns what stops it before it starts.
 */
export function tidyWhenIdle(): () => void {
  if (started) return () => undefined;
  const run = (): void => {
    started = true;
    void tidyHistory().catch(() => undefined);
  };
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run, { timeout: 3000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(run, 50);
  return () => clearTimeout(id);
}
