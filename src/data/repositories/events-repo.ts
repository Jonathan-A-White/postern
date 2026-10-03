import { db, type EventRow } from '../db';

/** The last event seq projected onto the view, in the settings table. */
const CURSOR_SETTING_KEY = 'events-cursor';

/** The seqs an emergency record applied ahead of the ordinary order (mw-jrx0s.13), so the ordinary pass skips them. */
const EARLY_SETTING_KEY = 'events-early';

/** The newest emergency seq he has tapped away: the banner shows only a later one. */
const CLEARED_SETTING_KEY = 'emergency-cleared';

/** mw-jrx0s.7: the factory's events (docs/protocol.md §22), kept once each by seq. */
export const eventsRepo = {
  /** Keeps every event whose seq is not held yet; resolves with those, in seq order.
   * An event already held is dropped, whichever record, lane or txid brought it. A new event
   * that clears an emergency (`clears`, docs/events.md) clears it as his tap does, in the same
   * setting, so the banner goes by itself and stays gone after a reload. */
  async addNew(events: EventRow[]): Promise<EventRow[]> {
    return db.transaction('rw', db.events, db.settings, async () => {
      const bySeq = new Map(events.map((event) => [event.seq, event]));
      const seqs = [...bySeq.keys()];
      const held = await db.events.bulkGet(seqs);
      const fresh = seqs.filter((_, i) => held[i] === undefined).map((seq) => bySeq.get(seq) as EventRow);
      await db.events.bulkAdd(fresh);
      const clears = Math.max(0, ...fresh.map((event) => event.clears ?? 0));
      if (clears > 0) await eventsRepo.clearEmergency(clears);
      return fresh.sort((a, b) => a.seq - b.seq);
    });
  },

  /** Every held event with a seq above `seq`, in seq order. */
  async after(seq: number): Promise<EventRow[]> {
    return db.events.where('seq').above(seq).sortBy('seq');
  },

  /** Every held event about any of `beads`, in seq order. */
  async forBeads(beads: string[]): Promise<EventRow[]> {
    return (await db.events.where('bead').anyOf(beads).toArray()).sort((a, b) => a.seq - b.seq);
  },

  /** Whether an event naming `txid` (a card_answered's answer record, say) is held. */
  async hasDetail(txid: string): Promise<boolean> {
    return (await db.events.where('detail').equals(txid).first()) !== undefined;
  },

  async cursor(): Promise<number> {
    const row = await db.settings.get(CURSOR_SETTING_KEY);
    return typeof row?.value === 'number' ? row.value : 0;
  },

  async setCursor(seq: number): Promise<void> {
    await db.settings.put({ key: CURSOR_SETTING_KEY, value: seq });
  },

  /** The seqs applied ahead of the cursor by an emergency record and not yet passed by it. */
  async early(): Promise<Set<number>> {
    const row = await db.settings.get(EARLY_SETTING_KEY);
    return new Set(Array.isArray(row?.value) ? row.value.filter((seq): seq is number => typeof seq === 'number') : []);
  },

  async setEarly(seqs: Iterable<number>): Promise<void> {
    await db.settings.put({ key: EARLY_SETTING_KEY, value: [...seqs] });
  },

  /** The newest held event of an emergency record (§22) that he has not tapped away. */
  async latestEmergency(): Promise<EventRow | undefined> {
    const cleared = await eventsRepo.emergencyCleared();
    const newest = await db.events
      .orderBy('seq')
      .reverse()
      .filter((event) => event.lane === 'emergency')
      .first();
    return newest && newest.seq > cleared ? newest : undefined;
  },

  async emergencyCleared(): Promise<number> {
    const row = await db.settings.get(CLEARED_SETTING_KEY);
    return typeof row?.value === 'number' ? row.value : 0;
  },

  /** His tap, or an event that says the alarm is over: every emergency up to `seq` is dealt with. */
  async clearEmergency(seq: number): Promise<void> {
    if (seq > (await eventsRepo.emergencyCleared())) await db.settings.put({ key: CLEARED_SETTING_KEY, value: seq });
  },
};
