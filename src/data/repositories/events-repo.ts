import { db, type EventRow } from '../db';

/** The last event seq projected onto the view, in the settings table. */
const CURSOR_SETTING_KEY = 'events-cursor';

/** mw-jrx0s.7: the factory's events (docs/protocol.md §22), kept once each by seq. */
export const eventsRepo = {
  /** Keeps every event whose seq is not held yet; resolves with those, in seq order.
   * An event already held is dropped, whichever record, lane or txid brought it. */
  async addNew(events: EventRow[]): Promise<EventRow[]> {
    return db.transaction('rw', db.events, async () => {
      const bySeq = new Map(events.map((event) => [event.seq, event]));
      const seqs = [...bySeq.keys()];
      const held = await db.events.bulkGet(seqs);
      const fresh = seqs.filter((_, i) => held[i] === undefined).map((seq) => bySeq.get(seq) as EventRow);
      await db.events.bulkAdd(fresh);
      return fresh.sort((a, b) => a.seq - b.seq);
    });
  },

  /** Every held event with a seq above `seq`, in seq order. */
  async after(seq: number): Promise<EventRow[]> {
    return db.events.where('seq').above(seq).sortBy('seq');
  },

  async cursor(): Promise<number> {
    const row = await db.settings.get(CURSOR_SETTING_KEY);
    return typeof row?.value === 'number' ? row.value : 0;
  },

  async setCursor(seq: number): Promise<void> {
    await db.settings.put({ key: CURSOR_SETTING_KEY, value: seq });
  },
};
