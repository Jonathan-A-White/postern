import { db, type CardRow, type StoredCardUpdate } from '../db';
import type { CardRecord } from '../../model/cards';

/** mw-nqur1n.11: live cards (docs/protocol.md §24), one row per card record, kept by its txid. */
export const cardsRepo = {
  async getAll(): Promise<CardRow[]> {
    return db.cards.toArray();
  },

  async get(id: string): Promise<CardRow | undefined> {
    return db.cards.get(id);
  },

  /** Keeps the card record; its updates and own ticks, held already, stay. A repeat is a no-op. */
  async putCard(id: string, card: CardRecord, thread: string | undefined): Promise<void> {
    await db.transaction('rw', db.cards, async () => {
      const row = (await db.cards.get(id)) ?? { id, updates: [], ticks: {} };
      await db.cards.put({ ...row, card, ...(thread ? { thread } : {}) });
    });
  },

  /** Keeps one update by its txid (a repeat replaces itself), whether or not its card has paged in yet. */
  async putUpdate(re: string, update: StoredCardUpdate): Promise<void> {
    await db.transaction('rw', db.cards, async () => {
      const row = (await db.cards.get(re)) ?? { id: re, updates: [], ticks: {} };
      await db.cards.put({ ...row, updates: [...row.updates.filter((held) => held.txid !== update.txid), update] });
    });
  },

  /** The app's own ticks: each item number gets the time (ms) of the event that settled it, once. */
  async tick(id: string, ticks: Record<number, number>): Promise<void> {
    await db.transaction('rw', db.cards, async () => {
      const row = await db.cards.get(id);
      if (!row) return;
      const fresh = Object.entries(ticks).filter(([n]) => row.ticks[n] === undefined);
      if (fresh.length === 0) return;
      await db.cards.put({ ...row, ticks: { ...row.ticks, ...Object.fromEntries(fresh) } });
    });
  },

  /** He tapped a link on the card: it counts as touched from now (never earlier than a touch held already). */
  async touch(id: string): Promise<void> {
    await db.transaction('rw', db.cards, async () => {
      const row = await db.cards.get(id);
      if (!row) return;
      await db.cards.put({ ...row, touchedAt: Math.max(row.touchedAt ?? 0, Date.now()) });
    });
  },
};
